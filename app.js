import {
  CATS, REPEAT, iso, parseDate, addDays, makeTask, toggleTask, sortTasks, filterTasks, groupTasks,
  monthGrid, dueTimestamp, dayStats, completionCopy, makeHabit, toggleHabitDay, habitWeek, applyTop,
  topStats, focusToday, breakMinutes, pickNudge, normalizeSettings, DEFAULT_SETTINGS, newId
} from './logic.js';
import { COLLS, cfgOk, fbRefs, initFirebase, localStore, cloudStore } from './store.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayStr = () => iso(new Date());
const nowHHMM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const DOW = ['пон', 'вто', 'сря', 'чет', 'пет', 'съб', 'нед'];
const DOW2 = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const DOW_LONG = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];
const TITLES = { today: 'Днес', cal: 'Календар', all: 'Всички', habits: 'Навици' };

/* ---------- Състояние ---------- */
let tasks = [], habits = [], reviews = [], focusLog = [], settings = { ...DEFAULT_SETTINGS };
let store = null;
let view = 'today';
let selDay = todayStr();
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let filterCat = '';
let query = '';
let editingId = null;

const norm = {
  tasks: l => { tasks = l.map(makeTask); },
  habits: l => { habits = l.map(makeHabit).filter(h => !h.archived && h.name); },
  reviews: l => { reviews = l; },
  focus: l => { focusLog = l; },
  settings: l => { settings = normalizeSettings(l.find(x => x.id === 'main')); }
};

function useStore(s) {
  store?.stop();
  store = s;
  for (const c of COLLS) s.subscribe(c, list => { norm[c](list); render(); });
  const cloud = s.mode === 'cloud';
  $('#syncPill').textContent = cloud ? 'Синхронизирано' : 'Локално';
  $('#syncPill').classList.toggle('on', cloud);
  $('#btnOut').hidden = !cloud;
}

/* ---------- Вход ---------- */
async function boot() {
  if (!cfgOk) { useStore(localStore()); return; }
  try {
    await initFirebase();
  } catch (e) {
    console.error(e);
    toast('Няма връзка с Firebase — работя локално');
    useStore(localStore());
    return;
  }
  const { fb, auth } = fbRefs;
  fb.onAuthStateChanged(auth, user => {
    if (user) {
      $('#login').hidden = true;
      useStore(cloudStore(user.uid, err => toast('Синхронизация: ' + (err.code || err.message))));
    } else if (store?.mode !== 'local') {
      $('#login').hidden = false;
    }
  });
}

async function signIn() {
  $('#loginErr').textContent = '';
  const { fb, auth } = fbRefs;
  const provider = new fb.GoogleAuthProvider();
  try {
    await fb.signInWithPopup(auth, provider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
      await fb.signInWithRedirect(auth, provider);
    } else if (e.code !== 'auth/popup-closed-by-user') {
      $('#loginErr').textContent = 'Входът не успя: ' + (e.code || e.message);
    }
  }
}

/* ---------- Задачи: рендериране ---------- */
function meta(t, today) {
  const parts = [];
  if (t.date) {
    const late = !t.done && t.date < today;
    const label = t.date === today ? 'Днес' : t.date === addDays(today, 1) ? 'Утре'
      : (() => { const d = parseDate(t.date); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; })();
    parts.push(`<span class="${late ? 'late' : ''}">${label}${t.time ? ' · ' + esc(t.time) : ''}</span>`);
  } else if (t.time) parts.push(`<span>${esc(t.time)}</span>`);
  const c = CATS[t.cat] || CATS.other;
  parts.push(`<span><i class="dot" style="background:${c.color}"></i>${c.name}</span>`);
  if (t.prio === 1) parts.push('<span>▲ висок</span>');
  if (t.repeat) parts.push(`<span>↻ ${REPEAT[t.repeat]}</span>`);
  if (t.pomos) parts.push(`<span>🍅 ${t.pomos}</span>`);
  if (t.notes) parts.push('<span>✎</span>');
  return parts.join('');
}

function taskHTML(t, today) {
  const star = t.done ? '' :
    `<button class="star ${t.top === today ? 'on' : ''}" data-star aria-label="Топ приоритет за днес" title="Топ 3 за днес">★</button>`;
  return `<li class="task ${t.done ? 'done' : ''}" data-id="${esc(t.id)}" data-prio="${t.prio}">
    <button class="chk" aria-label="Готово">✓</button>
    <div class="body"><div class="t">${esc(t.title)}</div><div class="meta">${meta(t, today)}</div></div>${star}
  </li>`;
}
const listHTML = (items, today) => `<ul class="list">${items.map(t => taskHTML(t, today)).join('')}</ul>`;
const emptyHTML = txt => `<div class="empty">${txt}</div>`;

/* ---------- Подсказка, навици и фокус на „Днес" ---------- */
const DISMISS_KEY = 'planner.dismiss';
function getDismissed() {
  try { const d = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}'); return d.day === todayStr() ? (d.ids || []) : []; } catch { return []; }
}
function dismiss(id) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify({ day: todayStr(), ids: [...getDismissed(), id] })); } catch {}
}

function nudgeHTML(today) {
  const n = pickNudge({ today, hhmm: nowHHMM(), tasks, reviews, settings, dismissed: getDismissed(), focusing: !!focus });
  if (!n) return '';
  return `<div class="nudge"><span class="ni">${n.icon}</span><p>${esc(n.text)}</p>
    <div class="na"><button class="primary sm" data-nudge="${n.action}">${esc(n.label)}</button>
    <button class="linkish" data-dismiss="${n.id}">не сега</button></div></div>`;
}

function habitStripHTML(today) {
  if (!habits.length) return '';
  return `<div class="hstrip">${habits.map(h =>
    `<button class="hchip ${h.days.includes(today) ? 'on' : ''}" data-habit="${esc(h.id)}">${esc(h.name)}</button>`).join('')}</div>`;
}

function focusRowHTML(today) {
  const f = focusToday(focusLog, today);
  const sub = f.sessions ? `днес: ${f.sessions} ${f.sessions === 1 ? 'сесия' : 'сесии'} · ${f.min} мин`
    : `${settings.pomoWork} мин работа, ${settings.pomoBreak} почивка`;
  return `<button class="focusbtn" data-focus>🍅 Фокус сесия <small>${sub}</small></button>`;
}

function renderToday(today) {
  const vis = filterTasks(tasks, { cat: filterCat, query });
  const tops = sortTasks(vis.filter(t => t.top === today));
  const topIds = new Set(tops.map(t => t.id));
  const open = sortTasks(vis.filter(t => !t.done && t.date && t.date <= today && !topIds.has(t.id)));
  const late = open.filter(t => t.date < today);
  const now = open.filter(t => t.date === today);
  const doneToday = vis.filter(t => t.done && t.doneAt === today && !topIds.has(t.id));
  let lists = '';
  if (tops.length) { const ts = topStats(tasks, today); lists += `<h3 class="group">★ Топ 3 за днес · ${ts.done}/${ts.total}</h3>${listHTML(tops, today)}`; }
  if (late.length) lists += `<h3 class="group late">Просрочени</h3>${listHTML(late, today)}`;
  if (now.length) lists += `<h3 class="group">Днес</h3>${listHTML(now, today)}`;
  if (doneToday.length) lists += `<h3 class="group">Изпълнени днес</h3>${listHTML(doneToday, today)}`;
  if (!lists) lists = emptyHTML(vis.length ? 'Нищо за днес. 🎉' : 'Още няма задачи.<br>Натисни + за първата.');
  const left = tasks.filter(t => !t.done && t.date && t.date <= today).length;
  $('#viewSub').textContent = left ? `${left} за вършене` : 'всичко е готово';
  return nudgeHTML(today) + habitStripHTML(today) + focusRowHTML(today) + lists;
}

function renderAll(today) {
  const groups = groupTasks(filterTasks(tasks, { cat: filterCat, query }), today);
  $('#viewSub').textContent = `${tasks.filter(t => !t.done).length} активни`;
  if (!groups.length) return emptyHTML('Няма намерени задачи.');
  return groups.map(([label, items, cls]) =>
    `<h3 class="group ${cls}">${label} · ${items.length}</h3>${listHTML(items, today)}`).join('');
}

function renderCal(today) {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const vis = filterTasks(tasks, { cat: filterCat, query });
  const byDay = {};
  vis.filter(t => t.date && !t.done).forEach(t => (byDay[t.date] ||= []).push(t));
  let h = `<div class="calhead"><button data-nav="-1" aria-label="Предишен">‹</button>
    <strong>${MONTHS[m]} ${y}</strong><button data-nav="1" aria-label="Следващ">›</button></div>
    <div class="grid">${DOW.map(d => `<div class="dow">${d}</div>`).join('')}`;
  for (const c of monthGrid(y, m)) {
    const dots = (byDay[c.date] || []).slice(0, 4)
      .map(t => `<i style="background:${(CATS[t.cat] || CATS.other).color}"></i>`).join('');
    h += `<button class="day ${c.inMonth ? '' : 'out'} ${c.date === today ? 'today' : ''} ${c.date === selDay ? 'sel' : ''}" data-day="${c.date}">
      ${c.day}<span class="dots">${dots}</span></button>`;
  }
  h += '</div>';
  const d = parseDate(selDay);
  const dayTasks = sortTasks(vis.filter(t => t.date === selDay));
  h += `<h3 class="group">${DOW_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}</h3>`;
  h += dayTasks.length ? listHTML(dayTasks, today) : emptyHTML('Няма задачи за този ден.');
  $('#viewSub').textContent = '';
  return h;
}

function renderHabits(today) {
  const doneN = habits.filter(h => h.days.includes(today)).length;
  $('#viewSub').textContent = habits.length ? `${doneN} от ${habits.length} днес` : '';
  let h = '<p class="hint">Избери 2–3 малки навика. Целта е да ги правиш редовно, не перфектно: един пропуснат ден не разваля нищо.</p>';
  if (habits.length) {
    h += '<ul class="list">' + habits.map(x => {
      const w = habitWeek(x, today);
      const dots = w.days.map(d => `<span class="${d.date === today ? 'today' : ''}"><i class="${d.done ? 'on' : ''}"></i>${DOW2[parseDate(d.date).getDay()]}</span>`).join('');
      return `<li class="habit"><button class="hcheck ${x.days.includes(today) ? 'on' : ''}" data-habit="${esc(x.id)}" aria-label="Отбележи за днес">✓</button>
        <div class="hbody"><div class="t">${esc(x.name)}</div><div class="hdots">${dots}</div>
        <div class="meta"><span>${w.count} от последните 7 дни</span></div></div>
        <button class="hdel" data-hdel="${esc(x.id)}" aria-label="Премахни навика">✕</button></li>`;
    }).join('') + '</ul>';
  } else h += emptyHTML('Още нямаш навици.<br>Добави първия по-долу.');
  if (habits.length >= 3) h += '<p class="hint">По-малко навици = по-голям шанс да се задържат. Добави нов, когато останалите станат лесни.</p>';
  h += `<form id="habitForm" class="inline"><input id="habitName" placeholder="Нов навик, напр. 10 мин разходка" maxlength="60" autocomplete="off"><button class="primary">Добави</button></form>
    <h3 class="group">Настройки</h3>
    <div class="settings">
      <label>Вечерна рекапитулация в <input type="time" data-set="reviewTime" value="${esc(settings.reviewTime)}"></label>
      <label>Работа (мин) <input type="number" inputmode="numeric" min="1" max="180" data-set="pomoWork" value="${settings.pomoWork}"></label>
      <label>Почивка (мин) <input type="number" inputmode="numeric" min="1" max="60" data-set="pomoBreak" value="${settings.pomoBreak}"></label>
      <label>Дълга почивка (мин) <input type="number" inputmode="numeric" min="1" max="90" data-set="pomoLong" value="${settings.pomoLong}"></label>
    </div>`;
  return h;
}

function renderKpi(today) {
  const st = dayStats(tasks, today);
  const ts = topStats(tasks, today);
  const fm = focusToday(focusLog, today);
  const tone = st.pct === null ? 'none' : st.pct >= 80 ? 'good' : st.pct >= 50 ? 'mid' : 'low';
  $('#kpi').dataset.tone = tone;
  $('#kpiNum').textContent = st.pct === null ? '—' : `${st.done}/${st.planned} · ${st.pct}%`;
  $('#kpiFill').style.width = (st.pct ?? 0) + '%';
  $('#kpiBar').setAttribute('aria-valuenow', String(st.pct ?? 0));
  const parts = [];
  parts.push(st.pct === null ? 'Няма планирани задачи за днес'
    : st.pct === 100 ? 'Всичко за днес е изпълнено 🎉'
    : `Остават ${st.left}` + (st.late ? ` · от тях ${st.late} просрочени` : ''));
  if (ts.total) parts.push(`Топ 3: ${ts.done}/${ts.total}`);
  if (fm.min) parts.push(`фокус ${fm.min} мин`);
  $('#kpiSub').textContent = parts.join(' · ');
}

function render() {
  const today = todayStr();
  renderKpi(today);
  $('#viewTitle').textContent = TITLES[view];
  $('#main').innerHTML = view === 'today' ? renderToday(today) : view === 'cal' ? renderCal(today)
    : view === 'habits' ? renderHabits(today) : renderAll(today);
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#toolbar').hidden = view === 'habits';
  $('#fab').hidden = view === 'habits';
  $('#catFilter').innerHTML =
    `<button class="chip ${filterCat ? '' : 'active'}" data-cat="">Всички</button>` +
    Object.entries(CATS).map(([k, c]) =>
      `<button class="chip ${filterCat === k ? 'active' : ''}" data-cat="${k}">${c.name}</button>`).join('');
  if ($('#dlgRecap').open) renderRecap();
}

/* ---------- Редакция на задача ---------- */
const dlg = $('#dlg');
$('#fCat').innerHTML = Object.entries(CATS).map(([k, c]) => `<option value="${k}">${c.name}</option>`).join('');

function openEditor(id, presetDate) {
  const t = id ? tasks.find(x => x.id === id) : null;
  editingId = t ? t.id : null;
  $('#dlgTitle').textContent = t ? 'Редакция' : 'Нова задача';
  $('#fTitle').value = t?.title || '';
  $('#fDate').value = t ? t.date : (presetDate || '');
  $('#fTime').value = t?.time || '';
  $('#fCat').value = t?.cat || (filterCat || 'other');
  $('#fPrio').value = String(t?.prio || 2);
  $('#fRepeat').value = t?.repeat || '';
  $('#fNotes').value = t?.notes || '';
  $('#btnDel').hidden = !t;
  dlg.showModal();
  if (!t) setTimeout(() => $('#fTitle').focus(), 50);
}

$('#form').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#fTitle').value.trim();
  if (!title) return;
  const old = editingId ? tasks.find(x => x.id === editingId) : null;
  const t = makeTask({
    ...(old || {}), id: editingId || undefined, title,
    date: $('#fDate').value, time: $('#fTime').value, cat: $('#fCat').value,
    prio: $('#fPrio').value, repeat: $('#fRepeat').value, notes: $('#fNotes').value.trim()
  });
  if (!old || old.date !== t.date || old.time !== t.time) notified.delete(t.id);
  store.save('tasks', t);
  dlg.close();
});
$('#btnCancel').onclick = () => dlg.close();
$('#btnDel').onclick = () => {
  if (editingId && confirm('Да изтрия ли задачата?')) { store.remove('tasks', editingId); dlg.close(); }
};
for (const d of ['#dlg', '#dlgPick', '#dlgFocus', '#dlgRecap'])
  $(d).addEventListener('click', e => { if (e.target === $(d)) $(d).close(); });

/* ---------- Топ 3 ---------- */
let pickSet = new Set();
function pickCandidates(day) {
  return sortTasks(tasks.filter(t => !t.done && (!t.date || t.date <= day))).slice(0, 30);
}
function renderPick() {
  const c = pickCandidates(todayStr());
  $('#pickList').innerHTML = c.length
    ? `<ul class="pick-list">${c.map(t => `<li data-id="${esc(t.id)}"><label><input type="checkbox" ${pickSet.has(t.id) ? 'checked' : ''}>
        <span class="t">${esc(t.title)}</span>${t.date && t.date < todayStr() ? '<small class="late">просрочена</small>' : ''}</label></li>`).join('')}</ul>`
    : '<p class="hint">Няма отворени задачи за избор. Добави с +.</p>';
}
function openPick() {
  pickSet = new Set(tasks.filter(t => t.top === todayStr()).map(t => t.id));
  renderPick();
  $('#dlgPick').showModal();
}
$('#pickList').addEventListener('change', e => {
  const li = e.target.closest('li'); if (!li) return;
  const id = li.dataset.id;
  if (e.target.checked) {
    if (pickSet.size >= 3) { e.target.checked = false; toast('Максимум 3 приоритета'); return; }
    pickSet.add(id);
  } else pickSet.delete(id);
});
$('#pickCancel').onclick = () => $('#dlgPick').close();
$('#pickSave').onclick = () => {
  applyTop(tasks, [...pickSet], todayStr()).forEach(t => store.save('tasks', t));
  $('#dlgPick').close();
  toast(pickSet.size ? `Топ ${pickSet.size} за днес е избран ★` : 'Приоритетите са изчистени');
};

/* ---------- Вечерна рекапитулация ---------- */
let recap = { stats: null, pick: new Set(), note: '' };
function openRecap() {
  const today = todayStr(), tomorrow = addDays(today, 1);
  // Снимка на деня преди преместванията, иначе КПД би се вдигнал изкуствено.
  recap = { stats: dayStats(tasks, today), pick: new Set(tasks.filter(t => t.top === tomorrow).map(t => t.id)), note: reviews.find(r => r.id === today)?.note || '' };
  renderRecap();
  if (!$('#dlgRecap').open) $('#dlgRecap').showModal();
}
function renderRecap() {
  const today = todayStr(), tomorrow = addDays(today, 1);
  const st = recap.stats;
  const open = sortTasks(tasks.filter(t => !t.done && t.date && t.date <= today));
  const cand = sortTasks(tasks.filter(t => !t.done && (!t.date || t.date <= tomorrow))).slice(0, 25);
  const tone = st.pct === null ? 'none' : st.pct >= 80 ? 'good' : st.pct >= 50 ? 'mid' : 'low';
  const dlgEl = $('#dlgRecap'), scroll = dlgEl.scrollTop;
  $('#rcBody').innerHTML = `
    <h2>🌙 Вечерна рекапитулация</h2>
    <div class="rc-score" data-tone="${tone}"><b>${st.pct === null ? '—' : st.pct + '%'}</b><span>${st.done} от ${st.planned} изпълнени днес</span></div>
    <h3 class="group">Неизпълнени · ${open.length}</h3>
    ${open.length ? `<ul class="rc-list">${open.map(t => `<li data-id="${esc(t.id)}"><span class="t">${esc(t.title)}</span>
        ${t.date < today ? '<small class="late">просрочена</small>' : ''}
        <span class="rc-btns"><button type="button" data-rc="tomorrow">→ Утре</button><button type="button" data-rc="drop" aria-label="Махни">✕</button></span></li>`).join('')}</ul>`
      : '<p class="hint">Всичко за днес е изпълнено 🎉</p>'}
    <h3 class="group">Какво мина добре днес?</h3>
    <input id="rcNote" maxlength="200" placeholder="Една победа, колкото и малка" value="${esc(recap.note)}">
    <h3 class="group">Топ 3 за утре · ${recap.pick.size}/3</h3>
    ${cand.length ? `<ul class="pick-list">${cand.map(t => `<li data-id="${esc(t.id)}"><label><input type="checkbox" data-rcpick ${recap.pick.has(t.id) ? 'checked' : ''}>
        <span class="t">${esc(t.title)}</span></label></li>`).join('')}</ul>`
      : '<p class="hint">Няма задачи за избор. Добави утрешните с +.</p>'}
    <div class="btns"><button type="button" id="rcClose">Затвори</button><span class="grow"></span>
      <button type="button" class="primary" id="rcFinish">Приключи деня</button></div>`;
  dlgEl.scrollTop = scroll;
}
$('#rcBody').addEventListener('input', e => { if (e.target.id === 'rcNote') recap.note = e.target.value; });
$('#rcBody').addEventListener('change', e => {
  if (!e.target.matches('[data-rcpick]')) return;
  const id = e.target.closest('li').dataset.id;
  if (e.target.checked) {
    if (recap.pick.size >= 3) { e.target.checked = false; toast('Максимум 3 приоритета'); return; }
    recap.pick.add(id);
  } else recap.pick.delete(id);
  renderRecap();
});
$('#rcBody').addEventListener('click', e => {
  const today = todayStr(), tomorrow = addDays(today, 1);
  const act = e.target.closest('[data-rc]');
  if (act) {
    const id = act.closest('li').dataset.id, t = tasks.find(x => x.id === id);
    if (!t) return;
    if (act.dataset.rc === 'tomorrow') store.save('tasks', { ...t, date: tomorrow });
    else if (confirm('Да махна ли задачата?')) { store.remove('tasks', id); recap.pick.delete(id); }
    return;
  }
  if (e.target.id === 'rcClose') $('#dlgRecap').close();
  if (e.target.id === 'rcFinish') {
    applyTop(tasks, [...recap.pick], tomorrow).forEach(t => store.save('tasks', t));
    store.save('reviews', {
      id: today, date: today, planned: recap.stats.planned, done: recap.stats.done, pct: recap.stats.pct,
      note: recap.note.trim(), tomorrow: [...recap.pick], created: Date.now()
    });
    $('#dlgRecap').close();
    toast(recap.pick.size ? `Денят е приключен. Утре: ${recap.pick.size} приоритета ★` : 'Денят е приключен. Лека нощ! 🌙');
  }
});

/* ---------- Фокус (Помодоро) ---------- */
const FOCUS_KEY = 'planner.focus.state';
let focus = null;
try { focus = JSON.parse(localStorage.getItem(FOCUS_KEY) || 'null'); } catch { focus = null; }
const saveFocus = () => { try { focus ? localStorage.setItem(FOCUS_KEY, JSON.stringify(focus)) : localStorage.removeItem(FOCUS_KEY); } catch {} };

let audioCtx = null;
function unlockAudio() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch {} }
function beep() {
  try {
    if (!audioCtx) return;
    [0, 0.3].forEach(d => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + 0.2);
    });
  } catch {}
}
async function notify(title, body, tag) {
  toast(`${title} ${body}`);
  beep();
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, tag, icon: 'icons/icon-192.png' };
    reg ? reg.showNotification(title, opts) : new Notification(title, opts);
  } catch {}
}

function startFocus({ taskId, workMin, breakMin }) {
  unlockAudio();
  const now = Date.now();
  focus = { phase: 'work', start: now, end: now + workMin * 60000, taskId: taskId || '', workMin, breakMin };
  saveFocus(); renderFocusBar(); tickFocus(); render();
}

function finishPhase() {
  if (!store || !focus) return;
  const f = focus, today = todayStr();
  if (f.phase === 'work') {
    const sid = newId();
    store.save('focus', { id: sid, day: today, min: f.workMin, taskId: f.taskId, at: Date.now() });
    const t = tasks.find(x => x.id === f.taskId);
    if (t) store.save('tasks', { ...t, pomos: t.pomos + 1, focusMin: t.focusMin + f.workMin });
    const n = focusLog.filter(s => s.day === today && s.id !== sid).length + 1;
    const len = breakMinutes(n, { pomoBreak: f.breakMin, pomoLong: settings.pomoLong });
    const now = Date.now();
    focus = { ...f, phase: 'break', start: now, end: now + len * 60000 };
    saveFocus();
    notify('🍅 Сесията приключи!', `Почивка ${len} мин${n % 4 === 0 ? ' (дълга)' : ''}. Стани, пий вода.`, 'focus');
  } else {
    focus = null; saveFocus();
    notify('☕ Почивката свърши.', 'Готов ли си за следваща сесия?', 'focus');
  }
  renderFocusBar(); render();
}

function fmt(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }
function renderFocusBar() {
  const bar = $('#focusBar');
  bar.hidden = !focus;
  if (!focus) { document.title = 'Планер'; return; }
  bar.dataset.phase = focus.phase;
  $('#fbIcon').textContent = focus.phase === 'work' ? '🍅' : '☕';
  const t = tasks.find(x => x.id === focus.taskId);
  $('#fbTask').textContent = focus.phase === 'break' ? 'Почивка' : (t ? t.title : 'Без избрана задача');
  $('#fbSkip').hidden = focus.phase !== 'break';
}
function tickFocus() {
  if (!focus) return;
  const left = focus.end - Date.now();
  if (left < -6 * 3600 * 1000) { focus = null; saveFocus(); renderFocusBar(); return; } // забравена отдавна
  if (left <= 0) { finishPhase(); return; }
  $('#fbTime').textContent = fmt(left);
  document.title = `${focus.phase === 'work' ? '🍅' : '☕'} ${fmt(left)} · Планер`;
}
setInterval(tickFocus, 500);

function openFocus() {
  if (focus) { toast('Вече има активна сесия'); return; }
  const today = todayStr();
  const open = sortTasks(tasks.filter(t => !t.done && (!t.date || t.date <= today)));
  const tops = open.filter(t => t.top === today), rest = open.filter(t => t.top !== today).slice(0, 25);
  const opt = t => `<option value="${esc(t.id)}">${t.top === today ? '★ ' : ''}${esc(t.title)}</option>`;
  $('#fTask').innerHTML = '<option value="">— без избрана задача —</option>' + [...tops, ...rest].map(opt).join('');
  if (tops[0]) $('#fTask').value = tops[0].id;
  $('#fWork').value = settings.pomoWork; $('#fBreak').value = settings.pomoBreak;
  $('#dlgFocus').showModal();
}
$('#focusForm').addEventListener('submit', e => {
  e.preventDefault();
  const cl = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : d; };
  startFocus({ taskId: $('#fTask').value, workMin: cl($('#fWork').value, 1, 180, settings.pomoWork), breakMin: cl($('#fBreak').value, 1, 60, settings.pomoBreak) });
  $('#dlgFocus').close();
});
$('#focusCancel').onclick = () => $('#dlgFocus').close();
$('#fbStop').onclick = () => {
  if (focus.phase === 'work' && !confirm('Да спра ли сесията? Няма да се запише.')) return;
  focus = null; saveFocus(); renderFocusBar(); render();
};
$('#fbSkip').onclick = () => { focus = null; saveFocus(); renderFocusBar(); render(); };

/* ---------- Събития ---------- */
$('#main').addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + Number(nav.dataset.nav), 1); render(); return; }
  const day = e.target.closest('[data-day]');
  if (day) {
    selDay = day.dataset.day;
    const d = parseDate(selDay);
    if (d.getMonth() !== calMonth.getMonth()) calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    render(); return;
  }
  const nd = e.target.closest('[data-nudge]');
  if (nd) { nd.dataset.nudge === 'top' ? openPick() : openRecap(); return; }
  const ds = e.target.closest('[data-dismiss]');
  if (ds) { dismiss(ds.dataset.dismiss); render(); return; }
  if (e.target.closest('[data-focus]')) { openFocus(); return; }
  const hb = e.target.closest('[data-habit]');
  if (hb) {
    const h = habits.find(x => x.id === hb.dataset.habit);
    if (h) store.save('habits', toggleHabitDay(h, todayStr()));
    return;
  }
  const hd = e.target.closest('[data-hdel]');
  if (hd) {
    const h = habits.find(x => x.id === hd.dataset.hdel);
    if (h && confirm(`Да премахна ли навика „${h.name}"?`)) store.save('habits', { ...h, archived: true });
    return;
  }
  const li = e.target.closest('.task');
  if (!li) return;
  const t = tasks.find(x => x.id === li.dataset.id);
  if (!t) return;
  const today = todayStr();
  if (e.target.closest('[data-star]')) {
    if (t.top === today) { store.save('tasks', { ...t, top: '' }); return; }
    if (tasks.filter(x => x.top === today).length >= 3) { toast('Вече имаш 3 приоритета. Махни един, за да смениш.'); return; }
    store.save('tasks', { ...t, top: today });
    return;
  }
  if (e.target.closest('.chk')) {
    const upd = toggleTask(t, today);
    store.save('tasks', upd);
    if (t.repeat && !t.done) {
      store.save('tasks', completionCopy(t, today)); // остава в историята и в КПД
      toast(`Следващо повторение: ${upd.date.split('-').reverse().join('.')}`);
    }
  } else openEditor(t.id);
});

$('#main').addEventListener('submit', e => {
  if (e.target.id !== 'habitForm') return;
  e.preventDefault();
  const name = $('#habitName').value.trim();
  if (!name) return;
  if (habits.length >= 5) { toast('Максимум 5 навика. Първо махни някой.'); return; }
  store.save('habits', makeHabit({ name }));
  $('#habitName').value = '';
});
$('#main').addEventListener('change', e => {
  const k = e.target.dataset?.set;
  if (!k) return;
  settings = normalizeSettings({ ...settings, [k]: e.target.value });
  store.save('settings', { id: 'main', ...settings });
  toast('Запазено');
  render();
});

$('.tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (b) { view = b.dataset.view; render(); window.scrollTo(0, 0); }
});
$('#catFilter').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (b) { filterCat = b.dataset.cat; render(); }
});
$('#search').addEventListener('input', e => { query = e.target.value; render(); });
$('#fab').onclick = () => openEditor(null, view === 'cal' ? selDay : (view === 'today' ? todayStr() : ''));
$('#btnRecap').onclick = openRecap;
$('#tagline').onclick = () => toast('1% на ден: 1,01 на степен 365 ≈ 37,8. Малките стъпки се натрупват.');
$('#btnGoogle').onclick = signIn;
$('#btnLocal').onclick = () => { $('#login').hidden = true; useStore(localStore()); };
$('#btnOut').onclick = async () => { if (confirm('Да изляза ли от профила?')) { await fbRefs.fb.signOut(fbRefs.auth); location.reload(); } };

document.addEventListener('keydown', e => {
  if ((e.key === 'n' || e.key === 'N') && ![...document.querySelectorAll('dialog')].some(d => d.open) &&
      !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    e.preventDefault(); $('#fab').click();
  }
});

/* ---------- Известия за задачи с час ---------- */
const notified = new Set();
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 3600);
}

$('#btnBell').onclick = async () => {
  if (!('Notification' in window)) { toast('Този браузър не поддържа известия'); return; }
  if (Notification.permission === 'granted') { toast('Напомнянията са включени'); return; }
  if (Notification.permission === 'denied') { toast('Блокирани от браузъра — разреши ги от настройките'); return; }
  const r = await Notification.requestPermission();
  toast(r === 'granted' ? 'Напомнянията са включени' : 'Не са разрешени');
};

async function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  for (const t of tasks) {
    if (t.done || notified.has(t.id)) continue;
    const due = dueTimestamp(t);
    if (due && due <= now && now - due < 10 * 60 * 1000) {
      notified.add(t.id);
      const reg = await navigator.serviceWorker?.getRegistration();
      const opts = { body: t.time + (t.notes ? ' · ' + t.notes : ''), tag: t.id, icon: 'icons/icon-192.png' };
      reg ? reg.showNotification(t.title, opts) : new Notification(t.title, opts);
    }
  }
}
setInterval(checkReminders, 30000);
// Подсказките зависят от часа: обновяваме на всяка минута, ако няма отворен диалог.
setInterval(() => { if (![...document.querySelectorAll('dialog')].some(d => d.open)) render(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); tickFocus(); checkReminders(); } });

/* ---------- Старт ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
renderFocusBar();
render();
boot();
