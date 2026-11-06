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
    subscribe(c, f) { subs[c] = f; f(lists[c]); },
    save(c, o) { const i = lists[c].findIndex(x => x.id === o.id); i >= 0 ? (lists[c][i] = o) : lists[c].push(o); persist(c); },
    remove(c, id) { lists[c] = lists[c].filter(x => x.id !== id); persist(c); },
    stop() {}
  };
}

export function cloudStore(uid, onError) {
  const { fb, db } = fbRefs;
  const unsubs = {};
  const col = c => fb.collection(db, 'users', uid, c);
  return {
    mode: 'cloud',
    subscribe(c, f) {
      unsubs[c]?.();
      unsubs[c] = fb.onSnapshot(col(c),
        snap => f(snap.docs.map(d => ({ ...d.data(), id: d.id }))),
        err => onError?.(err));
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
