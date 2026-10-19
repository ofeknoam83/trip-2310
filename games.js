// Live kids' games: desert trivia, truth-or-lie, desert bingo. One game at a time for the whole group.
import crypto from 'node:crypto';
import { TRIVIA } from './public/games-data.js';

const QUESTION_MS = 20000;
const REVEAL_MS = 7000;
const ROUND = 8;
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function mountGames({ io, store }) {
  let game = null; // in-memory live game
  let timer = null;

  const kid = (id) => store.get('kids', str(id, 40));
  async function addPoints(kidId, pts) {
    const k = kid(kidId); if (!k || !pts) return;
    const doc = await store.patch('kids', k.id, { points: (k.points || 0) + pts });
    io.emit('upsert', { coll: 'kids', doc, by: null });
  }

  // What players may see (never leak the right answer during a question)
  function view() {
    if (!game) return null;
    const g = { type: game.type, phase: game.phase, by: game.by, round: game.round };
    if (game.type === 'trivia') {
      const q = game.questions[game.idx];
      Object.assign(g, { idx: game.idx, total: game.questions.length, endsAt: game.endsAt, q: q.q, o: q.o, answered: Object.keys(game.answers) });
      if (game.phase === 'reveal' || game.phase === 'end') Object.assign(g, { answer: q.answer, fact: q.fact, answers: game.answers, gained: game.gained });
    }
    if (game.type === 'tf') {
      Object.assign(g, { teller: game.teller, statements: game.statements, voted: Object.keys(game.votes || {}) });
      if (game.phase === 'tfreveal') Object.assign(g, { trueIdx: game.trueIdx, votes: game.votes, gained: game.gained });
    }
    return g;
  }
  const broadcast = () => io.emit('game', view());
  const clear = () => { clearTimeout(timer); timer = null; };

  function askQuestion() {
    game.phase = 'question'; game.answers = {}; game.gained = {};
    game.endsAt = Date.now() + QUESTION_MS;
    clear(); timer = setTimeout(reveal, QUESTION_MS + 300);
    broadcast();
  }
  async function reveal() {
    if (!game || game.type !== 'trivia' || game.phase !== 'question') return;
    clear();
    const q = game.questions[game.idx];
    for (const [kidId, a] of Object.entries(game.answers)) {
      if (a.choice !== q.answer) continue;
      const left = Math.max(0, game.endsAt - a.t);
      const pts = 100 + Math.round((50 * left) / QUESTION_MS);
      game.gained[kidId] = pts;
      game.round[kidId] = (game.round[kidId] || 0) + pts;
      await addPoints(kidId, pts);
    }
    game.phase = game.idx >= game.questions.length - 1 ? 'end' : 'reveal';
    if (game.phase === 'reveal') timer = setTimeout(() => { if (game?.phase === 'reveal') { game.idx++; askQuestion(); } }, REVEAL_MS);
    broadcast();
  }

  const playingKids = new Map(); // socket.id -> kidId chosen on that phone
  io.on('connection', (s) => {
    s.emit('game', view());
    s.on('kid:select', (kidId) => { if (kid(kidId)) playingKids.set(s.id, kidId); else playingKids.delete(s.id); });
    s.on('disconnect', () => playingKids.delete(s.id));

    s.on('game:start', ({ type, by } = {}, ack) => {
      if (game && game.phase !== 'end') return ack?.({ ok: false, error: 'כבר יש משחק פעיל' });
      clear();
      if (type === 'trivia') {
        game = { type, by: str(by, 40), round: {}, questions: shuffle(TRIVIA).slice(0, ROUND), idx: 0 };
        askQuestion();
      } else if (type === 'tf') {
        game = { type, by: str(by, 40), round: {}, phase: 'compose' };
        broadcast();
      } else return ack?.({ ok: false, error: 'משחק לא מוכר' });
      ack?.({ ok: true });
    });

    s.on('game:stop', (_d, ack) => { clear(); game = null; broadcast(); ack?.({ ok: true }); });

    // trivia
    s.on('trivia:answer', ({ kidId, choice } = {}, ack) => {
      if (game?.type !== 'trivia' || game.phase !== 'question') return ack?.({ ok: false, error: 'השאלה נסגרה' });
      const k = kid(kidId); if (!k) return ack?.({ ok: false, error: 'בחרו שחקן' });
      if (game.answers[k.id]) return ack?.({ ok: false, error: 'כבר עניתם' });
      const c = Number(choice); if (!(c >= 0 && c < 4)) return ack?.({ ok: false });
      game.answers[k.id] = { choice: c, t: Date.now() };
      ack?.({ ok: true });
      // everyone who's playing answered → reveal early
      const playing = new Set(playingKids.values()).size;
      if (playing && Object.keys(game.answers).length >= playing) reveal(); else broadcast();
    });
    s.on('trivia:next', (_d, ack) => {
      if (game?.type !== 'trivia') return ack?.({ ok: false });
      if (game.phase === 'question') reveal();
      else if (game.phase === 'reveal') { game.idx++; askQuestion(); }
      ack?.({ ok: true });
    });

    // truth or lie
    s.on('tf:submit', ({ kidId, a, b, trueIdx } = {}, ack) => {
      if (game?.type !== 'tf' || game.phase !== 'compose') return ack?.({ ok: false, error: 'מישהו אחר כבר משחק עכשיו' });
      const k = kid(kidId); if (!k) return ack?.({ ok: false, error: 'בחרו שחקן' });
      const A = str(a, 160), B = str(b, 160); if (!A || !B) return ack?.({ ok: false, error: 'צריך שני משפטים' });
      // shuffle order so position doesn't give it away
      const flip = crypto.randomInt(2) === 1;
      Object.assign(game, { phase: 'vote', teller: k.id, statements: flip ? [B, A] : [A, B], trueIdx: flip ? 1 - Number(!!trueIdx) : Number(!!trueIdx), votes: {}, gained: {} });
      broadcast(); ack?.({ ok: true });
    });
    s.on('tf:vote', ({ kidId, pick } = {}, ack) => {
      if (game?.type !== 'tf' || game.phase !== 'vote') return ack?.({ ok: false });
      const k = kid(kidId); if (!k) return ack?.({ ok: false, error: 'בחרו שחקן' });
      if (k.id === game.teller) return ack?.({ ok: false, error: 'אי אפשר לנחש את המשפטים של עצמך 😉' });
      game.votes[k.id] = Number(pick) === 1 ? 1 : 0;
      broadcast(); ack?.({ ok: true });
    });
    s.on('tf:reveal', async (_d, ack) => {
      if (game?.type !== 'tf' || game.phase !== 'vote') return ack?.({ ok: false });
      let fooled = 0;
      for (const [kidId, pick] of Object.entries(game.votes)) {
        if (pick === game.trueIdx) { game.gained[kidId] = 100; await addPoints(kidId, 100); }
        else fooled++;
      }
      if (fooled) { game.gained[game.teller] = 50 * fooled; await addPoints(game.teller, 50 * fooled); }
      for (const [k, p] of Object.entries(game.gained)) game.round[k] = (game.round[k] || 0) + p;
      game.phase = 'tfreveal'; broadcast(); ack?.({ ok: true });
    });
    s.on('tf:next', (_d, ack) => {
      if (game?.type !== 'tf') return ack?.({ ok: false });
      Object.assign(game, { phase: 'compose', teller: null, statements: null, votes: {}, gained: {} });
      broadcast(); ack?.({ ok: true });
    });

    // bingo (cards live on the phone; a full line earns points)
    s.on('bingo:win', async ({ kidId } = {}, ack) => {
      const k = kid(kidId); if (!k) return ack?.({ ok: false, error: 'בחרו שחקן' });
      await addPoints(k.id, 150);
      io.emit('bingo', { kidId: k.id, name: k.name });
      ack?.({ ok: true });
    });
  });
}
