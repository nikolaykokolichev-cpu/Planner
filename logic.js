// Чиста логика (без DOM) — лесна за тестване.

export const CATS = {
  work:     { name: 'Работа',   color: '#3b82f6' },
  kids:     { name: 'Деца',     color: '#f59e0b' },
  money:    { name: 'Финанси',  color: '#10b981' },
  personal: { name: 'Лично',    color: '#a855f7' },
  other:    { name: 'Други',    color: '#94a3b8' }
};
export const PRIO = { 1: 'Висок', 2: 'Среден', 3: 'Нисък' };
export const REPEAT = { daily: 'всеки ден', weekly: 'всяка седмица', monthly: 'всеки месец' };

const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return iso(d); };

export function addMonths(s, n) {
  const d = parseDate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));          // 31 яну + 1 месец -> 28/29 фев
  return iso(d);
}

export function nextDate(date, repeat, today) {
  const base = date || today;
  if (repeat === 'daily') return addDays(base, 1);
  if (repeat === 'weekly') return addDays(base, 7);
  if (repeat === 'monthly') return addMonths(base, 1);
  return base;
}

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

export function makeTask(p = {}) {
  return {
    id: p.id || newId(),
    title: (p.title || '').trim(),
    notes: p.notes || '',
    date: p.date || '',
    time: p.time || '',
    cat: CATS[p.cat] ? p.cat : 'other',
    prio: [1, 2, 3].includes(Number(p.prio)) ? Number(p.prio) : 2,
    repeat: ['daily', 'weekly', 'monthly'].includes(p.repeat) ? p.repeat : '',
    done: !!p.done,
    doneAt: p.doneAt || '',
    top: p.top || '',
    pomos: Number(p.pomos) || 0,
    focusMin: Number(p.focusMin) || 0,
    created: p.created || Date.now()
  };
}

// Маркира като изпълнена или за повтаряща се задача — прехвърля към следващата дата.
export function toggleTask(t, today) {
  if (!t.done && t.repeat) {
    return { ...t, date: nextDate(t.date, t.repeat, today), top: '', pomos: 0, focusMin: 0 };
  }
  return { ...t, done: !t.done, doneAt: !t.done ? today : '' };
}

export function sortTasks(list) {
  return [...list].sort((a, b) =>
    (a.done - b.done) ||
    (a.date || '9999').localeCompare(b.date || '9999') ||
    (a.time || '99:99').localeCompare(b.time || '99:99') ||
    (a.prio - b.prio) ||
    (a.created - b.created)
  );
}

export function filterTasks(list, { cat = '', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return list.filter(t =>
    (!cat || t.cat === cat) &&
    (!q || t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q))
  );
}

// Групи за изглед „Всички". Връща [[етикет, [задачи], 'late'|'']].
export function groupTasks(list, today) {
  const tomorrow = addDays(today, 1);
  const g = { late: [], today: [], tomorrow: [], later: [], none: [], done: [] };
  for (const t of sortTasks(list)) {
    if (t.done) g.done.push(t);
    else if (!t.date) g.none.push(t);
    else if (t.date < today) g.late.push(t);
    else if (t.date === today) g.today.push(t);
    else if (t.date === tomorrow) g.tomorrow.push(t);
    else g.later.push(t);
  }
  g.done.reverse();
  return [
    ['Просрочени', g.late, 'late'], ['Днес', g.today, ''], ['Утре', g.tomorrow, ''],
    ['Предстоящи', g.later, ''], ['Без дата', g.none, ''], ['Изпълнени', g.done.slice(0, 30), '']
  ].filter(x => x[1].length);
}

// Дните в мрежата на месеца (понеделник първи), винаги цели седмици.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const days = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((offset + days) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date: iso(d), day: d.getDate(), inMonth: d.getMonth() === month };
  });
}

export function dueTimestamp(t) {
  if (!t.date || !t.time) return null;
  const [y, m, d] = t.date.split('-').map(Number);
  const [hh, mm] = t.time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

// Запис за изпълнение на повтаряща се задача: затворено копие, за да се брои в КПД и историята.
export function completionCopy(t, today) {
  return makeTask({ ...t, id: newId(), repeat: '', done: true, doneAt: today, created: Date.now() });
}

// КПД за деня: планирани = всичко, което е за днес или просрочено и още отворено,
// плюс всичко, изпълнено днес (дори ако е било планирано за друг ден).
export function dayStats(list, today) {
  const doneToday = list.filter(t => t.done && t.doneAt === today).length;
  const openDue = list.filter(t => !t.done && t.date && t.date <= today);
  const late = openDue.filter(t => t.date < today).length;
  const planned = doneToday + openDue.length;
  const pct = planned ? Math.round((doneToday / planned) * 100) : null;
  return { planned, done: doneToday, left: openDue.length, late, pct };
}

/* ---------- Настройки ---------- */
export const DEFAULT_SETTINGS = { reviewTime: '21:00', pomoWork: 25, pomoBreak: 5, pomoLong: 15 };
const clamp = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export function normalizeSettings(s) {
  s = s || {};
  return {
    reviewTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.reviewTime || '') ? s.reviewTime : DEFAULT_SETTINGS.reviewTime,
    pomoWork: clamp(s.pomoWork, 1, 180, DEFAULT_SETTINGS.pomoWork),
    pomoBreak: clamp(s.pomoBreak, 1, 60, DEFAULT_SETTINGS.pomoBreak),
    pomoLong: clamp(s.pomoLong, 1, 90, DEFAULT_SETTINGS.pomoLong)
  };
}

/* ---------- Топ 3 приоритета ---------- */
// Връща само променените задачи: избраните получават top=day, а махнатите го губят.
export function applyTop(list, ids, day) {
  const set = new Set(ids);
  const changed = [];
  for (const t of list) {
    const want = set.has(t.id);
    if (want && t.top !== day) changed.push({ ...t, top: day });
    else if (!want && t.top === day) changed.push({ ...t, top: '' });
  }
  return changed;
}
export function topStats(list, day) {
  const tt = list.filter(t => t.top === day);
  return { total: tt.length, done: tt.filter(t => t.done).length };
}

/* ---------- Навици ---------- */
export function makeHabit(p = {}) {
  return {
    id: p.id || newId(),
    name: (p.name || '').trim().slice(0, 60),
    days: Array.isArray(p.days) ? [...new Set(p.days)].sort() : [],
    created: p.created || Date.now(),
    archived: !!p.archived
  };
}
export function toggleHabitDay(h, day) {
  const days = h.days.includes(day) ? h.days.filter(d => d !== day) : [...h.days, day].sort();
  return { ...h, days: days.slice(-400) };
}
// Последните 7 дни (до днес включително) и колко от тях са изпълнени. Без серии, без наказания.
export function habitWeek(h, today) {
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = addDays(today, -i); days.push({ date: d, done: h.days.includes(d) }); }
  return { days, count: days.filter(x => x.done).length };
}

/* ---------- Фокус (Помодоро) ---------- */
export function focusToday(log, day) {
  const x = log.filter(s => s.day === day);
  return { sessions: x.length, min: x.reduce((a, s) => a + (Number(s.min) || 0), 0) };
}
// Всяка 4-та сесия за деня е с дълга почивка.
export function breakMinutes(n, s) { return n > 0 && n % 4 === 0 ? s.pomoLong : s.pomoBreak; }

/* ---------- Една подсказка наведнъж ---------- */
export function pickNudge({ today, hhmm, tasks, reviews, settings, dismissed = [], focusing = false }) {
  if (focusing) return null;
  const ok = id => !dismissed.includes(id);
  const reviewed = reviews.some(r => r.id === today);
  const openDue = tasks.filter(t => !t.done && t.date && t.date <= today);
  const late = openDue.filter(t => t.date < today).length;
  const topToday = tasks.filter(t => t.top === today).length;
  const candidates = tasks.some(t => !t.done && (!t.date || t.date <= today));
  if (!reviewed && hhmm >= settings.reviewTime && ok('recap'))
    return { id: 'recap', icon: '🌙', action: 'recap', label: 'Започни',
      text: 'Време е за вечерна рекапитулация: 10 минути да затвориш деня и да подредиш утрешния.' };
  if (hhmm < '14:00' && topToday === 0 && candidates && ok('top'))
    return { id: 'top', icon: '☀︎', action: 'top', label: 'Избери',
      text: 'Избери 3-те най-важни задачи за днес. Всичко останало е бонус.' };
  if (late >= 3 && ok('late'))
    return { id: 'late', icon: '⚠︎', action: 'recap', label: 'Подреди',
      text: `${late} просрочени задачи. Реши за всяка: утре или я махни.` };
  return null;
}
