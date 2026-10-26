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
    created: p.created || Date.now()
  };
}

// Маркира като изпълнена или за повтаряща се задача — прехвърля към следващата дата.
export function toggleTask(t, today) {
  if (!t.done && t.repeat) {
    return { ...t, date: nextDate(t.date, t.repeat, today) };
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
