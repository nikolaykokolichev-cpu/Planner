import { firebaseConfig } from './firebase-config.js';
import {
  CATS, PRIO, REPEAT, iso, parseDate, addDays, makeTask, toggleTask, sortTasks,
  filterTasks, groupTasks, monthGrid, dueTimestamp
} from './logic.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => iso(new Date());
const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const DOW = ['пон', 'вто', 'сря', 'чет', 'пет', 'съб', 'нед'];
const DOW_LONG = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

/* ---------- Състояние ---------- */
let tasks = [];
let store = null;
let view = 'today';
let selDay = todayStr();
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let filterCat = '';
let query = '';
let editingId = null;

/* ---------- Хранилища ---------- */
function localStore() {
  const KEY = 'planner.tasks.v1';
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { list = []; }
  let cb = () => {};
  const persist = () => { localStorage.setItem(KEY, JSON.stringify(list)); cb(list); };
  return {
    mode: 'local',
    subscribe(f) { cb = f; f(list); },
    save(t) { const i = list.findIndex(x => x.id === t.id); i >= 0 ? (list[i] = t) : list.push(t); persist(); },
    remove(id) { list = list.filter(x => x.id !== id); persist(); },
    stop() {}
  };
}

function cloudStore(fb, db, uid) {
  const col = fb.collection(db, 'users', uid, 'tasks');
  let unsub = null;
  return {
    mode: 'cloud',
    subscribe(f) {
      unsub?.();
      unsub = fb.onSnapshot(col, snap => f(snap.docs.map(d => makeTask({ ...d.data(), id: d.id }))),
        err => toast('Грешка при синхронизация: ' + err.code));
    },
    // Без await: офлайн записът се пази локално и се изпраща при връзка.
    save(t) { const { id, ...rest } = t; fb.setDoc(fb.doc(col, id), rest).catch(e => toast('Не се записа: ' + e.code)); },
    remove(id) { fb.deleteDoc(fb.doc(col, id)).catch(e => toast('Не се изтри: ' + e.code)); },
    stop() { unsub?.(); }
  };
}

function useStore(s) {
  store?.stop();
  store = s;
  s.subscribe(list => { tasks = list; render(); });
  const cloud = s.mode === 'cloud';
  $('#syncPill').textContent = cloud ? 'Синхронизирано' : 'Локално';
  $('#syncPill').classList.toggle('on', cloud);
  $('#btnOut').hidden = !cloud;
}

/* ---------- Firebase ---------- */
const cfgOk = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PASTE');
let fb = null, auth = null, db = null;

async function initFirebase() {
  const V = '10.14.1', base = `https://www.gstatic.com/firebasejs/${V}`;
  const [app, fs, au] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
    import(`${base}/firebase-auth.js`)
  ]);
  const a = app.initializeApp(firebaseConfig);
  db = fs.initializeFirestore(a, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
  });
  auth = au.getAuth(a);
  fb = { ...fs, ...au };
}

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
  fb.onAuthStateChanged(auth, user => {
    if (user) { $('#login').hidden = true; useStore(cloudStore(fb, db, user.uid)); }
    else if (store?.mode !== 'local') { $('#login').hidden = false; }
  });
}

async function signIn() {
  $('#loginErr').textContent = '';
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

/* ---------- Рендериране ---------- */
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
  if (t.notes) parts.push('<span>✎</span>');
  return parts.join('');
}

function taskHTML(t, today) {
  return `<li class="task ${t.done ? 'done' : ''}" data-id="${esc(t.id)}" data-prio="${t.prio}">
    <button class="chk" aria-label="Готово">✓</button>
    <div class="body"><div class="t">${esc(t.title)}</div><div class="meta">${meta(t, today)}</div></div>
  </li>`;
}

const listHTML = (items, today) => `<ul class="list">${items.map(t => taskHTML(t, today)).join('')}</ul>`;
const emptyHTML = txt => `<div class="empty">${txt}</div>`;

function renderToday(today) {
  const vis = filterTasks(tasks, { cat: filterCat, query });
  const open = sortTasks(vis.filter(t => !t.done && t.date && t.date <= today));
  const late = open.filter(t => t.date < today);
  const now = open.filter(t => t.date === today);
  const doneToday = vis.filter(t => t.done && t.doneAt === today);
  let h = '';
  if (late.length) h += `<h3 class="group late">Просрочени</h3>${listHTML(late, today)}`;
  if (now.length) h += `<h3 class="group">Днес</h3>${listHTML(now, today)}`;
  if (doneToday.length) h += `<h3 class="group">Изпълнени днес</h3>${listHTML(doneToday, today)}`;
  if (!h) h = emptyHTML(vis.length ? 'Нищо за днес. 🎉' : 'Още няма задачи.<br>Натисни + за първата.');
  const left = open.length;
  $('#viewSub').textContent = left ? `${left} за вършене` : 'всичко е готово';
  return h;
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

function render() {
  const today = todayStr();
  $('#viewTitle').textContent = { today: 'Днес', cal: 'Календар', all: 'Всички задачи' }[view];
  $('#main').innerHTML = view === 'today' ? renderToday(today) : view === 'cal' ? renderCal(today) : renderAll(today);
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#catFilter').innerHTML =
    `<button class="chip ${filterCat ? '' : 'active'}" data-cat="">Всички</button>` +
    Object.entries(CATS).map(([k, c]) =>
      `<button class="chip ${filterCat === k ? 'active' : ''}" data-cat="${k}">${c.name}</button>`).join('');
}

/* ---------- Диалог ---------- */
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
  // При смяна на дата/час — позволи ново напомняне
  if (!old || old.date !== t.date || old.time !== t.time) notified.delete(t.id);
  store.save(t);
  dlg.close();
});
$('#btnCancel').onclick = () => dlg.close();
$('#btnDel').onclick = () => {
  if (editingId && confirm('Да изтрия ли задачата?')) { store.remove(editingId); dlg.close(); }
};
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

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
  const li = e.target.closest('.task');
  if (!li) return;
  const t = tasks.find(x => x.id === li.dataset.id);
  if (!t) return;
  if (e.target.closest('.chk')) {
    const upd = toggleTask(t, todayStr());
    store.save(upd);
    if (t.repeat && !t.done) toast(`Следващо повторение: ${upd.date.split('-').reverse().join('.')}`);
  } else openEditor(t.id);
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
$('#btnGoogle').onclick = signIn;
$('#btnLocal').onclick = () => { $('#login').hidden = true; useStore(localStore()); };
$('#btnOut').onclick = async () => { if (confirm('Да изляза ли от профила?')) { await fb.signOut(auth); location.reload(); } };

document.addEventListener('keydown', e => {
  if ((e.key === 'n' || e.key === 'N') && !dlg.open && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    e.preventDefault(); $('#fab').click();
  }
});

/* ---------- Известия (работят, докато приложението е отворено) ---------- */
const notified = new Set();
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 3200);
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); checkReminders(); } });

/* ---------- Старт ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
boot();
