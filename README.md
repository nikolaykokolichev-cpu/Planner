# Планер

Задачи + календар, синхронизирани между Mac, Windows и iPhone. Инсталира се като приложение (PWA), работи и офлайн.

## Файлове
- `index.html`, `style.css`, `app.js`, `logic.js` — приложението
- `firebase-config.js` — тук се слагат ключовете от Firebase
- `firestore.rules` — правила за сигурност (всеки вижда само своите данни)
- `manifest.json`, `sw.js`, `icons/` — инсталиране и офлайн режим

## Без Firebase (локален режим)
Докато `firebase-config.js` съдържа `PASTE_...`, приложението работи, но данните са само в това устройство.

## Настройка на синхронизацията (еднократно, ~10 мин.)
1. console.firebase.google.com → **Add project** (Analytics не е нужен).
2. **Build → Authentication → Get started → Google → Enable** (избери имейл за поддръжка).
3. **Build → Firestore Database → Create database** (production mode, регион `eur3`).
4. В Firestore → **Rules** постави съдържанието на `firestore.rules` → **Publish**.
5. **Project settings → General → Your apps → Web (`</>`)** → регистрирай приложение → копирай `firebaseConfig` във `firebase-config.js`.
6. **Authentication → Settings → Authorized domains** → добави домейна, на който ще е публикувано (напр. `ТВОЕТО-ИМЕ.github.io`).

## Публикуване (GitHub Pages)
Repo → **Settings → Pages → Deploy from a branch → `main` / root**. Линкът е `https://ТВОЕТО-ИМЕ.github.io/planner/`.

## Инсталиране
- **iPhone:** Safari → Share → *Add to Home Screen*.
- **Mac/Windows:** Chrome или Edge → иконата „Инсталирай" в адресната лента.

## Известия
Бутон 🔔 → разреши. Напомнянията се показват, докато приложението е отворено (или на заден план). Истински push при затворено приложение изисква сървърна част (Cloud Functions) — следваща стъпка.

## Бързи клавиши
`N` — нова задача.
