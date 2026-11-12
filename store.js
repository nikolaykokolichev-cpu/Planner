// Хранилище: локално (само на това устройство) или Firebase (синхронизирано).
// Всичко е под users/{uid}/<колекция>, което вече е защитено от firestore.rules.
import { firebaseConfig } from './firebase-config.js';

export const COLLS = ['tasks', 'habits', 'reviews', 'focus', 'settings'];
export const cfgOk = !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PASTE'));
export const fbRefs = { fb: null, auth: null, db: null };

export async function initFirebase() {
  const V = '10.14.1', base = `https://www.gstatic.com/firebasejs/${V}`;
  const [app, fs, au] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
    import(`${base}/firebase-auth.js`)
  ]);
  const a = app.initializeApp(firebaseConfig);
  fbRefs.db = fs.initializeFirestore(a, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
  });
  fbRefs.auth = au.getAuth(a);
  fbRefs.fb = { ...fs, ...au };
}

export function localStore() {
  const key = c => `planner.${c}.v1`;
  const lists = {};
  const subs = {};
  for (const c of COLLS) {
    try { lists[c] = JSON.parse(localStorage.getItem(key(c)) || '[]'); } catch { lists[c] = []; }
  }
  const persist = c => { try { localStorage.setItem(key(c), JSON.stringify(lists[c])); } catch {} subs[c]?.(lists[c]); };
  return {
    mode: 'local',
    subscribe(c, f) { subs[c] = l => f(l, { fromCache: false }); subs[c](lists[c]); },
    save(c, o) { const i = lists[c].findIndex(x => x.id === o.id); i >= 0 ? (lists[c][i] = o) : lists[c].push(o); persist(c); },
    remove(c, id) { lists[c] = lists[c].filter(x => x.id !== id); persist(c); },
    stop() {}
  };
}

// Слуша колекция и съобщава и кога данните станат потвърдени от сървъра,
// без излишни извиквания при промени само в метаданните.
function listen(ref, f, onError) {
  const { fb } = fbRefs;
  let first = true, lastCache = null;
  return fb.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
    const fromCache = snap.metadata.fromCache;
    if (!first && fromCache === lastCache && !snap.docChanges().length) return;
    first = false; lastCache = fromCache;
    f(snap.docs.map(d => ({ ...d.data(), id: d.id })), { fromCache });
  }, err => onError?.(err));
}

export function cloudStore(uid, onError) {
  const { fb, db } = fbRefs;
  const unsubs = {};
  const col = c => fb.collection(db, 'users', uid, c);
  return {
    mode: 'cloud',
    // f(списък, { fromCache }) — fromCache=false означава потвърдено от сървъра.
    subscribe(c, f) {
      unsubs[c]?.();
      unsubs[c] = listen(fb.collection(db, 'users', uid, c), f, onError);
    },
    // Без await: офлайн записът се пази локално и се изпраща при връзка.
    save(c, o) {
      const { id, ...rest } = o;
      fb.setDoc(fb.doc(col(c), id), JSON.parse(JSON.stringify(rest))).catch(e => onError?.(e));
    },
    remove(c, id) { fb.deleteDoc(fb.doc(col(c), id)).catch(e => onError?.(e)); },
    stop() { Object.values(unsubs).forEach(u => u?.()); }
  };
}

// Мост за външен асистент: bridge/{key}/inbox (входящи операции) и bridge/{key}/status (огледало).
// Ключът е тайната: който го знае, може да пуска операции и да чете статуса.
export function cloudBridge(key, onError) {
  const { fb, db } = fbRefs;
  const inbox = fb.collection(db, 'bridge', key, 'inbox');
  const status = fb.collection(db, 'bridge', key, 'status');
  const unsubs = [];
  const err = e => onError?.(e);
  return {
    key,
    onInbox(f) { unsubs.push(listen(inbox, f, onError)); },
    onStatus(f) { unsubs.push(listen(status, f, onError)); },
    ack(id) { fb.deleteDoc(fb.doc(inbox, id)).catch(err); },
    setStatus(id, data) { fb.setDoc(fb.doc(status, id), data).catch(err); },
    removeStatus(id) { fb.deleteDoc(fb.doc(status, id)).catch(err); },
    stop() { unsubs.forEach(u => u?.()); }
  };
}
