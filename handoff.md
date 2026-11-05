# Finlyt: handoff

Paused on 2026-11-05 (evening session). This file is the checkpoint to resume from. **`plan.md` holds the design, decisions and phase checklist. This file holds the current state, what to do next, and things learned the hard way.**

## Where things stand

| Area | State |
|---|---|
| Repo | `~/Developer/finlyt`, git on `master`. **Nothing is committed yet.** A `.github/modernize/` folder appeared at 10:30 that day, from some other tool (a Java-upgrade hook). It isn't Finlyt's, so ask before committing it. |
| Keys | The user put their keys in the **repo-root `.env`** (`NEON`, `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET_KEY`, `GEMINI_API_KEY`). They're copied into `backend/.env` (`DATABASE_URL` pooled, `DATABASE_URL_UNPOOLED` = the same host without `-pooler`, `GOOGLE_WEB_CLIENT_ID`, `GEMINI_API_KEY`, `ALLOWED_EMAILS=*`) and `mobile/.env` (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`). Never print them. `GOOGLE_SECRET_KEY` isn't used. |
| Database | Neon project in ap-southeast-1, a single branch (only one URL was given, so there's no separate `dev`). Migration `679d931f7960` is applied. `/api/health?db=1` → `{"ok":true,"db":true}`. Nothing else has been written to it. |
| Backend | Phases 1 and 3 are coded. Phase 3 adds `POST /api/log/propose` (JSON text or multipart AAC voice note) and `POST /api/log/commit` (all or nothing; expenses, paybacks, transfers, ignored). **33 tests pass** against a local Postgres. Checked live against real Gemini with typed text and an AAC voice note, and over HTTP end to end (propose → commit → stats) on a local database. Not deployed to Vercel yet. |
| App | Phase 2 shell, plus **brand** (icon, adaptive and themed icon, splash, notification icon, logo on sign-in, coin mascot) and **phase 3 UI**: the Log tab records a voice note or takes text, then "Make expenses" opens the Review screen, then Save. Typecheck, lint and `expo export --platform android` pass. **Never run on a device.** |
| Native Android | `mobile/android/` was regenerated with `expo prebuild --clean` after all the app.json changes (icons, splash, `expo-audio` with background playback off, `react-native-svg`). The debug APK build status is in "Debug APK" below. |
| Running processes | The local Flask on :5050 (Neon) and the throwaway Postgres on :54329 were stopped at the end of the session. |

## Waiting on the user

1. ~~Google Cloud → Android OAuth client~~ **Done 2026-11-05; sign-in works.** For reference: Go to console.cloud.google.com → project Finlyt → Google Auth Platform → Clients → Create client → **Android**. Package `com.finlyt.app`, SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` (rechecked after prebuild). There's nothing to copy back. Without it, sign-in fails with `DEVELOPER_ERROR`.
2. **Getting the app onto the Pixel.** The user doesn't want to be asked to plug in, and expected to use Expo Go. **Expo Go can't run Finlyt**: native Google sign-in, and later the SMS module, need the app's own dev build. Once that's installed it works like Expo Go: open it, and it loads JS from `npx expo start` with hot reload. Ways to install without a cable:
   - **Wireless debugging:** phone → Developer options → Wireless debugging → Pair device with pairing code. Then on the Mac: `adb pair <ip>:<pair-port>` (enter the code), `adb connect <ip>:<port>`, and `adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk`. `adb reverse tcp:5050 tcp:5050` works over Wi-Fi too.
   - **Or EAS Build** in the cloud: needs an Expo account (`npx eas-cli@latest login`), and gives a download link.
   - Without adb reverse, set `EXPO_PUBLIC_API_URL=http://<Mac LAN IP>:5050` (it was `192.168.0.103` that day) and restart Metro.
   - SMS phase later: Play Protect in India blocks sideloaded apps that ask for SMS, so install with adb then.
3. Later: a Vercel login (deploy).

## Debug APK

`cd mobile/android && ./gradlew assembleDebug` was run with JDK 17 at the end of the session. Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. See "Session result" at the bottom for whether it finished.

## Resume checklist (in order)

1. Read `plan.md`. Ask whether the Android OAuth client exists yet.
2. Backend:
   ```sh
   cd backend && uv sync
   uv run flask --app app run --host 0.0.0.0 --port 5050
   ```
3. App, once it's on the phone (see "Waiting on the user"):
   ```sh
   cd mobile && source ~/.nvm/nvm.sh && nvm use
   npx expo start        # then open the Finlyt dev build on the phone
   ```
4. Verify on the phone:
   - Sign-in works.
   - Settings → "Send a test reminder".
   - Log: type "chai 40 cash", tap Make expenses, review, save. Home updates.
   - Log: record a voice note with a split ("lunch 450, Rahul owes 200, half cash"), then Review. Check the issues and questions show up.
   - The mic permission prompt appears the first time.
   - The launcher icon is a white coin on blue. The themed icon works with Android 13+ themed icons on. The splash is a coin on blue.
5. Then: ask about the first git commit (and the `.github/modernize` folder). Deploy to Vercel (`npx vercel login`, `npx vercel link` with root `backend`, env vars, `npx vercel --prod`). Switch `EXPO_PUBLIC_API_URL`. Tick phases 0–3 in `plan.md`.
6. Next feature: **phase 4, Claude-chat import** (spec in `plan.md`). Reuse `services/dues.settle` for `payback` entries and `create_expense(..., source="import", import_batch_id=...)`.

## Running backend tests

The DB tests need `TEST_DATABASE_URL`. **Their tables are dropped and recreated**, so never point it at Neon. Use a throwaway local Postgres (Homebrew `postgresql@14`; its binaries are in `/opt/homebrew/opt/postgresql@14/bin`, which isn't on PATH):

```sh
export PATH="/opt/homebrew/opt/postgresql@14/bin:$PATH"
PGDATA=/some/temp/dir/pgdata
initdb -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C
pg_ctl -D "$PGDATA" -o "-p 54329 -c unix_socket_directories='' -c listen_addresses=localhost" -l "$PGDATA.log" -w start
createdb -h localhost -p 54329 -U postgres finlyt_test
cd backend && TEST_DATABASE_URL=postgresql://postgres@localhost:54329/finlyt_test uv run pytest -q
pg_ctl -D "$PGDATA" -m fast stop
```

- Gemini is faked in tests (`app.extensions["finlyt.gemini"]`). There's no live Gemini test in the suite.
- `uv run flask --app app dev-token you@example.com` prints a session token for curl. **It creates that user in whatever `DATABASE_URL` points at**, so for HTTP tests point `DATABASE_URL` at a local database (env vars win over `.env`).
- Lint: `uvx ruff@0.14.4 check finlyt_api tests` is clean. The code isn't ruff-formatted; don't run `ruff format`.

## Lessons from this session (non-obvious)

- **Gemini free tier is flaky.** `gemini-3.8-flash` (newest) kept returning 503 "high demand" or hanging until 504. `gemini-3.5-flash` usually answered in 3–8 s, but it also returned 503 at times. So `GeminiProposer` tries `3.5-flash → 3.8-flash → 2.5-flash`, with no same-model retries and a 40 s timeout each. Gemini 3 takes `thinking_level`; 2.5 needs `thinking_budget` instead. Billing on the key would also stop Google training on prompts (see `plan.md`).
- The SDK is `google-genai` 2.34. Structured output uses `response_json_schema=GProposal.model_json_schema()`, and `$defs` work.
- Gemini officially accepts `audio/aac` (ADTS), not m4a. So the app records `outputFormat: "aac_adts"`, mono, 16 kHz, 32 kbps, about 4 KB/s. On macOS, `afconvert -f adts -d aac -c 1 -b 32000 in.aiff out.aac` makes test files (`say -o x.aiff "..."` for speech). The file-type code is lowercase `adts`.
- **SDK 58's global `fetch` is Expo's own (`expo/winter/fetch`), not React Native's.** React Native's `FormData.append(name, { uri, name, type })` file parts fail with `Unsupported FormDataPart implementation` before any request goes out. Parts must be a string, a Blob, or an object with `name`, `type` and `bytes()`. The voice note is sent as `{ name: "note.aac", type: "audio/aac", bytes: () => new File(uri).arrayBuffer()… }` using `expo-file-system`'s `File`. expo-file-system was already linked into the APK through `expo`; it's now a direct dependency.
- `api()` now includes the underlying error in "Can't reach the Finlyt server (…)" and `console.warn`s it, which shows up in the Metro log.
- expo-audio's config plugin adds `FOREGROUND_SERVICE_MEDIA_PLAYBACK` unless `enableBackgroundPlayback: false`. It's off.
- `useAudioRecorder(options, statusListener)`: the listener gets `{isFinished, url}` when recording stops, including when `record({ forDuration })` hits the limit. The Log tab uses that rather than an effect.
- The Log/Review shared state (text, voice note, proposal, saved message) is in `mobile/src/lib/log-draft.ts`, using `useSyncExternalStore`. That way Review can clear the Log tab after saving.
- **Brand assets:** `mobile/scripts/render-brand.js` renders every icon PNG from the canvas geometry (`npm i --no-save @resvg/resvg-js@2.6.2 && node scripts/render-brand.js`). The adaptive foreground maps the canvas's 100-unit icon onto the visible 72 dp of the 108 dp layer (viewBox `-25 -25 150 150`). Expo's placeholder `assets/expo.icon` (the iOS icon) was deleted.
- Earlier sessions' lessons still apply: zsh doesn't word-split `$VAR`; use Node 22 via nvm; JDK 17 for Gradle; the SDK is in `~/Library/Android/sdk`; Expo SDK 58 notes are in `mobile/AGENTS.md`; stats need the timezone as a SQL literal; SMS fixtures use made-up names.
- `react-native-svg` 15.16 accepts SVG transform strings (`transform="rotate(-10 50 52)"`).

## Key files (new this session)

```
backend/finlyt_api/gemini.py              Gemini schema (rupees, labels) + model fallback chain
backend/finlyt_api/services/proposals.py  prompt building, mapping to ids/paise, issues, commit
backend/finlyt_api/services/dues.py       paybacks: settle open dues oldest first
backend/finlyt_api/routes/log.py          /api/log/propose (JSON or multipart) and /api/log/commit
backend/finlyt_api/money.py               to_paise / rupees (Indian grouping)
backend/tests/test_log.py                 12 tests, Gemini faked
mobile/src/components/brand.tsx           Coin (moods, badge/bare) and Logo (coin + wordmark)
mobile/src/app/(tabs)/log.tsx             recorder + text → propose
mobile/src/app/log/review.tsx             editable proposal → commit
mobile/src/lib/log-draft.ts               shared Log/Review state
mobile/scripts/render-brand.js            regenerates icon/splash/notification PNGs
```

## Loose ends and ideas

- The Review screen shows the time but can't edit it yet. Add Today/Yesterday chips or a time picker if Gemini gets times wrong.
- The Log tab doesn't play the recording back. Add playback if voice notes get misheard.
- History/Owed empty states could use the coin (sleepy/happy). Notifications can't show the mascot. The notification icon is the white coin.
- Optional extra sample SMS: Kotak debit card, ATM, NEFT/IMPS. DNS Bank's sender ID is still unknown.
- Account and category management screens don't exist yet.

## Session result

- **The debug APK built** (`BUILD SUCCESSFUL in 12m 30s`): `mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 298 MB because it covers all 4 ABIs. For faster rebuilds on the Pixel only, add `-PreactNativeArchitectures=arm64-v8a`.
- **Installed on the Pixel over wireless debugging** (no cable). The phone was first on a different network (`192.168.1.x`, while the Mac is on `192.168.0.x` behind router `192.168.0.1`), so the Mac couldn't reach it. After moving the phone to the Mac's Wi-Fi it was `192.168.0.102`. Steps that worked:
  - Discover: `adb mdns services` lists `_adb-tls-pairing._tcp` while the pairing popup is open, and `_adb-tls-connect._tcp` for connecting. Only the 6-digit code is needed from the user.
  - Then `adb pair <pairing ip:port> <code>`, `adb connect <ip:port>`, `adb install -r`, and `adb reverse tcp:5050` / `tcp:8081`.
  - Open the dev build on Metro: `adb shell am start -a android.intent.action.VIEW -d "exp+finlyt://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" com.finlyt.app`.
  - Don't start Metro with `CI=1`: that turns off reloads.
- The app launches and the sign-in screen renders with the new logo (checked by screenshot in dark mode). Sign-in first failed with `DEVELOPER_ERROR`. The user then created the Android OAuth client, and **Google sign-in worked** about 2 minutes later without a rebuild.
- The user saved a first real expense by hand (it's in Neon), and Home shows it. The floating gear on screen is the dev client's tools button, so it only appears in dev builds.
- **Voice logging works on the phone** (record → Gemini 3.5 Flash → Review → Save, 201). The first try failed: see the `expo/fetch` lesson below. The fix in `useProposeLog` went out by hot reload; no rebuild was needed.
- **The user confirmed everything works on the phone** (2026-11-05): sign-in, manual add, voice and text logging, review/save, reminders, history, icon. Phases 2 and 3 are ticked in `plan.md`.
- Next: the first git commit (ask about `.github/modernize/`), then deploy to Vercel so the app works away from the Mac, then phase 4 (Claude-chat import).
