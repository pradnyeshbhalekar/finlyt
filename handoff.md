# Finlyt: handoff

Paused on 2026-11-05 (evening session). This file is the checkpoint to resume from. **`plan.md` holds the design, decisions and phase checklist. This file holds the current state, what to do next, and things learned the hard way.**

## Where things stand

| Area | State |
|---|---|
| Repo | `~/Developer/finlyt`, branch `main`, pushed to the **public** repo github.com/pradnyeshbhalekar/finlyt (first commit `ee7c140`, 2026-11-05). The user asked for **no Claude co-author line** in commits. Real bank details (account last-4s, UPI refs) were redacted from `plan.md` before pushing; keep real SMS data out of the repo. `.github/modernize/` (from another tool) ignores its own contents, so it's never committed. |
| Keys | The user put their keys in the **repo-root `.env`** (`NEON`, `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET_KEY`, `GEMINI_API_KEY`). They're copied into `backend/.env` (`DATABASE_URL` pooled, `DATABASE_URL_UNPOOLED` = the same host without `-pooler`, `GOOGLE_WEB_CLIENT_ID`, `GEMINI_API_KEY`, `ALLOWED_EMAILS=*`) and `mobile/.env` (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`). Never print them. `GOOGLE_SECRET_KEY` isn't used. |
| Database | Neon project in ap-southeast-1, a single branch (only one URL was given, so there's no separate `dev`). Migration `679d931f7960` is applied. `/api/health?db=1` → `{"ok":true,"db":true}`. Nothing else has been written to it. |
| Backend | **Deployed: https://finlyt-api.vercel.app** (Vercel project `finlyt-api`, sin1, `maxDuration` 120 s for Gemini fallbacks). Redeploy with `cd backend && npx vercel@65.11.0 deploy --prod --yes`; see plan.md → Vercel. Phases 1 and 3 are done, 33 tests pass. Local Flask is now only for development, and it shares the same Neon database. |
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

## UI redesign (2026-11-05, late)

The user asked for a minimal, modern UI like their mockup (Home with check-in, total, list and composer), no emojis, proper icons, three themes from the logo canvas, logging by typing the way they talk, a check-before-saving setting with auto-save as the alternative, and reminder times in onboarding. All of that is done and running on the phone:

- No tabs. `src/app/index.tsx` is Home and the logging screen. `history`, `owed`, `settings`, `log/review` and `expense/new` are stack screens; `onboarding` is gated by `prefs.onboarded`.
- Components: `ui.tsx` (Txt with weight/tone, Button, Row, Segmented, SwitchRow, Sheet…), `composer.tsx` (text, voice, send), `proposal-card.tsx`, `time-picker.tsx` (pure JS), `reminder-editor.tsx` and `category-icon.tsx` (Lucide icon by category name).
- New JS-only deps: `lucide-react-native` and `@expo-google-fonts/inter`. `expo-file-system` was added earlier. **No native rebuild was needed.**
- The Gemini prompt now explains casual and Hinglish typing ("usko dena hai", "dedh sau", "1.2k", "split X with A and B"). It asks at most two questions and never about payment method or category. Six casual phrasings were checked live and all came out right. Deployed to Vercel.
- **Coin reactions:** Home's header logo is `HeaderLogo` (`brand.tsx`). The coin is split from the type and animated with Reanimated (`.set()`/`.get()` for the React Compiler). It turns happy with a bounce and wiggle while the "Saved" toast shows, which covers every save path: straight away, the check card, the Check entries screen, and add by hand (that now also shows "Saved · Undo"). It looks up and bobs while Gemini reads, and it's sleepy from 22:00 to 06:00.
- **Tagline:** from the user's site https://finlyt.onrender.com: "Never forget an expense." It's the sign-in headline. The subtitle is the site's description minus "picks up your UPI payments by itself", because SMS pickup (phase 5) isn't built; add it back once it is.
- The user confirmed onboarding and Home render on the Pixel (Dark theme). The Ink theme and the auto-save toast haven't been looked at on the device yet.

## Quick parse and on-device voice (2026-11-05, night)

The user asked that simple text be parsed without AI, with Gemini only for complex notes, and the same for voice.

- **Backend** `services/quick_parse.py`: `/api/log/propose` tries it first and replies with `model: "quick"` when it succeeds. Simple means every item (split on commas, "and"/"aur", new lines; "15,000" is one number) has one amount plus a known spend word (keyword table → category), optionally with a payment word (cash/nakad → Cash, upi/gpay/card → primary, or an account name or bank code). Anything with people, splits, paybacks, time words, "plus/more/+", two numbers in one item, unknown words, or pending bank txns (unless paid in cash) goes to Gemini. 26 tests in `tests/test_quick_parse.py`; 61 in total. Deployed.
- **App**: the mic now does **speech-to-text on the phone** (`expo-speech-recognition` 58.0.1, `lang: en-IN`, live interim results into the composer, stops after 2 s of silence, hints = accounts, people, common places). The user then taps send, and the text goes through quick parse or Gemini like typed text. `src/lib/speech.ts` loads the module with `requireOptionalNativeModule`. Builds without it, or phones without a recognizer, fall back to the AAC voice note sent to Gemini.
- That needed a **native rebuild**: `./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a` (10m 46s, 107 MB), installed over wireless adb with `install -r` (sign-in and prefs kept). The Pixel's recognizers are `com.google.android.as` and `com.google.android.tts`.
- Not yet tried on the phone by the user: dictation itself.

## Sunday check-in planning (2026-11-05, night) — deployed

The user's ask: every Sunday they talk with Finlyt about the coming week, the way they used to with Claude, and get a plan with a daily limit. Their choices: a **monthly budget with weekly check-ins**; money not spent under the limit is **kept aside for unplanned things** (the buffer), not added to later days.

- **Backend (done, 68 tests pass):** tables `budgets` (per month), `plans` (daily limit from `starts_on`; the latest plan on or before a day applies) and `planned_items` (bigger spends set aside first; spending in their category that month counts against them up to their amount). Migration `a3c9e1f2b7d4_planning.py`. `services/planning.py` computes everything: today left = limit − today's everyday spend; buffer = Σ(limit − everyday spend) over past planned days this month; suggested limit = ⌊(budget − spent − planned left) ÷ days left⌋ rounded down to ₹10. Routes: `GET /api/plan`, `POST /api/plan/chat` (Gemini via `GeminiPlanner`, a multi-turn chat with structured output: reply, ready, budget, daily limit, planned items, summary; `resolve_plan` checks it and fills in defaults), `POST /api/plan` (save). A live three-turn chat gave a sensible ₹650/day plan.
- **App (done, hot-reloaded):** `PlanStrip` on Home (progress bar, "₹X left today of ₹Y", "₹Z saved for surprises", "this month ₹A of ₹B", and a "Sunday check-in" / "Plan your month" card when due). `src/app/plan.tsx` is the chat with Finlyt bubbles (coin avatar with moods), plan card, "Use this plan". The mic uses `useDictation` (`lib/speech.ts`, now shared with the composer). Weekly Sunday reminder (default 7 PM, editable under Settings → Planning) opens `/plan`.
- **Deployed** after the user said "go ahead": Neon migrated to `a3c9e1f2b7d4`; Vercel has `/api/plan`. The first probe right after the deploy still returned 404, while the alias propagated; it was 401 seconds later.
- **Next after that:** phase 5, SMS (the user asked to start it).

## Phase 5: SMS (2026-11-05, late night) — deployed and installed

- **Phone:** local Expo module `mobile/modules/sms-reader` (Kotlin; `hasPermission()`, `readInbox(sinceMillis, limit)` over `Telephony.Sms.Inbox`, oldest first). Its manifest adds `READ_SMS`. JS wrapper `modules/sms-reader/index.ts` uses `requireOptionalNativeModule`. `src/lib/sms.ts`: `syncSms(filters)` reads from a cursor (`finlyt.smsCursor` in SecureStore, starting at today 00:00 on the first sync) in batches of 200. It keeps only bank SMS (alphanumeric sender plus sender pattern or body marker from `/api/meta` `sms_filters`, minus OTPs), posts them to `/api/sms/sync`, and moves the cursor only after the upload succeeds.
- **Home:** an "Allow" card for SMS (PermissionsAndroid READ_SMS). Sync runs on open, when the app returns to the foreground, and on pull-to-refresh. "To log" (`components/to-log.tsx`) lists pending txns (name, time · UPI · account, amount; credits show "+₹"). Tap selects one: the composer asks "What was Zomato?" and the propose call sends `txn_ids: [id]`, so Gemini links it as T1. Long-press marks it as a transfer, income or ignored. The header shows "N to log".
- **Backend:** `sms_parsers.py` (Kotak debit, Kotak debit to a name, Kotak credit, DNS debit, DNS credit; OTP guard; `display_name()` turns a VPA into "Zomato"/"Ravi Kumar"/"UPI QR payment"), `services/sms.py` (dedupe by body hash and by (account, ref); the bank named in the body wins over the sender id; auto-link a debit to a logged payment with the same account, amount and IST day), `routes/sms.py`: `POST /api/sms/sync`, `GET /api/txns`, `POST /api/txns/<id>/resolve`. 11 tests (`tests/test_sms.py`, all values made up); 79 in total.
- **Deployed** after the user's "go ahead". `/api/txns` returns 401 and `/api/sms/sync` returns 405 to unauthenticated GETs, so both routes exist. Each production deploy needs the user's explicit OK (the auto-mode classifier blocks it otherwise).
- **APK** with the SMS module (7m 39s, arm64, `READ_SMS` and `RECORD_AUDIO` confirmed with aapt2) is **installed**. Wireless debugging had switched itself off once (`adb: device offline`); after the user re-enabled it, the connect port changed to `192.168.0.102:36703` (find it with `adb mdns services`). Vercel logs after install showed `/api/plan/chat` 200 (the user started a check-in), and `/api/plan` and `/api/txns` 200.
- Not yet seen on the device: the user granting SMS access and real bank SMS appearing under "To log".
- zsh gotcha: never use `path` as a loop variable (it's tied to `PATH`).

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
- **Don't render text before custom fonts load.** On Android, text laid out with the fallback font keeps that width after Inter loads, and gets clipped ("Continu"). `RootNavigator` returns null until `useFonts` is done; the splash covers it.
- Changing `tailwind.config.js` (new colour tokens) needs Metro restarted with `--clear`. Fast Refresh doesn't pick it up.
- Themes use NativeWind `vars()` on the root `View`. Context reaches stack screens and `Modal`s because they're in the same React tree.
- With multiple adb transports (mDNS plus manual), use `adb -s 192.168.0.102:<port>`.
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
- Committed and pushed (`ee7c140`). **Backend deployed to Vercel**, and `mobile/.env` → `EXPO_PUBLIC_API_URL=https://finlyt-api.vercel.app`. The phone's requests were confirmed in Vercel's logs (all 200). The app is still a dev build, so it needs Metro on the Mac to load its JS.
- Next: a standalone release APK, so the app works without Metro. The template's release build signs with the debug key, so the existing Android OAuth client still matches. Then phase 4 (Claude-chat import).
