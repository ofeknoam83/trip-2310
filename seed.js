// Initial data, taken from the WhatsApp group "טיול 23-24/10".
// Everything here is editable from the site; the seed only runs on an empty database.

export const people = [
  { id: 'noam', rsvp: 'with',  name: 'נועם אופק',   avatar: '/avatars/noam.jpg',  color: '#ff9e4a', companions: 'עמית' },
  { id: 'omer', rsvp: 'with',  name: 'עומר קנת',    avatar: '/avatars/omer.jpg',  color: '#5ee6c8', companions: 'יואב, תום ונועם' },
  { id: 'ido',   name: 'עידו שושני',  avatar: '/avatars/ido.jpg',   color: '#ffd166', companions: '' },
  { id: 'yoav',  name: 'יואב הורנונג', avatar: '/avatars/yoav.jpg',  color: '#9b8cff', companions: '' },
  { id: 'dolev', rsvp: 'with', name: 'דולב',        avatar: '/avatars/dolev.jpg', color: '#ff6b8b', companions: 'יפתח' },
  { id: 'yair',  name: 'יאיר מור',    avatar: '/avatars/yair.jpg',  color: '#62b6ff', companions: '' },
  { id: 'sarel', name: 'שראל דניר',   avatar: '/avatars/sarel.jpg',                 color: '#c3f584', companions: '' },
  { id: 'tomer', name: 'תומר מגל',    avatar: '/avatars/tomer.jpg', color: '#f4a3ff', companions: '' },
];

const now = Date.now();
let n = 0;
const ts = () => now + n++;

export const tasks = [
  { title: 'אוכל לכל החבר׳ה', owners: ['omer', 'dolev'], note: 'עומר ודולב לקחו על עצמם', done: false },
  { title: 'אלכוהול', owners: ['omer'], note: '', done: false },
  { title: 'מסלול ונקודת לינה', owners: ['tomer', 'ido'], note: 'ערבה (נחל פרצים / נחל סדום) או מדבר יהודה', done: false },
  { title: 'לקבוע שעה ונקודת מפגש', owners: [], note: 'עידו: עדיף לקבוע שעה ולהיפגש בה ולא להצטרף באמצע', done: false },
  { title: 'קצין עזרה ראשונה', owners: [], note: '', done: false },
  { title: 'קצין מדורה וקפה', owners: [], note: '', done: false },
].map((t) => ({ ...t, createdBy: 'system', createdAt: ts() }));

export const supplies = [
  { item: 'אוהלים', cat: 'לינה' },
  { item: 'מים לקבוצה (ג׳ריקנים)', cat: 'אוכל ושתייה' },
  { item: 'כירה, גז ופינג׳אן', cat: 'אוכל ושתייה' },
  { item: 'צידנית וקרח', cat: 'אוכל ושתייה' },
  { item: 'עצים למדורה', cat: 'מחנה' },
  { item: 'שולחן וכיסאות מתקפלים', cat: 'מחנה' },
  { item: 'שקיות זבל', cat: 'מחנה' },
  { item: 'ערכת עזרה ראשונה', cat: 'בטיחות' },
  { item: 'ציוד חילוץ: רצועה, שאקלים, קומפרסור', cat: 'רכב' },
  { item: 'מכשיר קשר / סוללת גיבוי לטלפון', cat: 'בטיחות' },
].map((s) => ({ ...s, scope: 'shared', packedBy: [], qty: '', bringer: null, done: false, createdBy: 'system', createdAt: ts() }));

export const personalSupplies = [
  'שק שינה', 'מזרן שטח', 'כרית', 'פנס ראש + סוללות', 'מים – 3 ליטר לפחות לאדם ליום',
  'בגדים חמים ללילה', 'כובע וקרם הגנה', 'נעליים סגורות', 'כוס, צלחת וסכו״ם', 'תרופות אישיות',
].map((item) => ({ item, cat: 'אישי', scope: 'personal', packedBy: [], qty: '', bringer: null, done: false, createdBy: 'system', createdAt: ts() }));

export const info = {
  title: 'טיול 23-24/10',
  dates: 'שישי–שבת, 23–24 באוקטובר',
  start: '2026-10-23T09:00:00+03:00',
  area: 'ערבה או מדבר יהודה – טרם הוחלט',
  meeting: '',
  meetingTime: '',
  notes: 'אבות + ילדים. לינה באוהלים בשטח (בחניון אם זו שמורת טבע). יאיר יוצא מהמרכז בסביבות 15:00.',
};
