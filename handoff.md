# Finlyt: handoff

Paused on 2026-11-07: month reports, money memory and Import from AI are built and pushed but NOT deployed (Neon + Vercel), and not on the phone. Bigger days and the chosen check-in day are deployed. Before that, 2026-11-06 and 2026-11-05. This file is the checkpoint to resume from. **`plan.md` holds the design, decisions and phase checklist. This file holds the current state, what to do next, and things learned the hard way.**

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

## Connection notes (2026-11-05, late night)

- The phone's Wi-Fi sometimes drops for a moment or hops networks. Each time, wireless debugging restarts on a **new port** (39897 → 36703 → 44839); find it with `adb mdns services`. During a drop the app showed `UnknownHostException` for `finlyt-api.vercel.app`, but the router, 8.8.8.8 and the phone itself resolved it fine afterwards. It isn't a DNS block. Private DNS on the phone is off.
- **Open the dev build on Metro over Wi-Fi, not through adb reverse**, so a dropped adb link doesn't cut the app off from its JS: `adb shell am start -a android.intent.action.VIEW -d "exp+finlyt://expo-development-client/?url=http%3A%2F%2F192.168.0.103%3A8081" com.finlyt.app`. Metro listens on the LAN (`curl http://192.168.0.103:8081/status`).
- `api()` now retries GETs once after 1.5 s on a network error (never writes) and shows a plain offline message. The check-in has a Try again button.
- Committed and pushed `e3b5694` (redesign, quick parse, speech, planning, SMS). Module build output is now gitignored.

## Plan section, site-style splash and step-by-step onboarding (2026-11-05, ~22:20)

The user asked: take planning out of Settings into its own section, make the splash like https://finlyt.onrender.com, and make onboarding better, one thing at a time.

- **Plan section:** `app/plan/index.tsx` (overview: month spent of budget with a bar, days left; a Today card with left of limit and "Saved for surprises"; "Set aside this month" items with Paid ticks; the Sunday check-in time, editable; "Talk to Finlyt" button) and `app/plan/chat.tsx` (the chat, moved from `app/plan.tsx`). Reached from a Target icon in Home's header and from the Home strip. The Sunday reminder opens `/plan/chat`. Settings no longer has planning.
- **Site look:** the website uses Geist, paper `#FAFAF9` / navy `#0B1033` / black, the eyebrow "Expense tracker for Android", the headline "Never forget an expense again." and a light pill button. The app now uses **Geist** (`@expo-google-fonts/geist`; Inter removed). The Light background is `#FAFAF9`, and **Auto maps dark mode to Ink (navy)**, like the site; "Dark" is still black. The native splash is paper with a blue coin, or navy with a white coin (`splash-icon-light/dark.png` from `render-brand.js`), and needed a rebuild (installed). `components/intro.tsx` replays the site hero on each cold start (logo, eyebrow, headline, copy fade in one by one, tap to skip). It closes 900 ms after the last line's entering animation finishes (Reanimated `withCallback` plus `scheduleOnRN`), with a 5 s fallback. A plain 2 s timer cut it short in the dev build.
- **Sign-in:** a hero like the site, with an inverse pill "Continue with Google".
- **Onboarding** (`app/onboarding.tsx`): five steps with progress dots and back: welcome with four features → check-in times → "Show me first" or "Save straight away" cards → bank SMS (sample row; Allow or Not now; skipped without the SMS module) → "Want a daily limit?" (Plan with Finlyt opens `/plan/chat` after finishing). Each step's parts use `FadeInDown` with staggered delays, and a new key per step replays them.
- Gotcha: Reanimated `Animated.View` ignores NativeWind `className`; put classes on an inner `View`.
- Not yet seen on the phone: the new onboarding (the user is already onboarded) and the fixed intro (the user was mid check-in, so no cold restart).

## Splash ported from the website, tap bounce, entry screen (2026-11-05, ~22:40)

- **Splash** (`components/splash.tsx`) ports finlyt.onrender.com's `Splash.jsx`. The exact keyframes were pulled from the site's public bundle (`/assets/index-*.js`): pop 0–450 ease-out; dance 400–1400 ease-in-out (±12°, 1.06/0.94 squash, −16%/−24% hops, bottom-centre pivot); blink 400–1400 (scaleY 0.1 at 37%); slide 1450–1950 cubic-bezier(0.5,0,0.2,1); letters from 1500, 80 ms apart, 420 ms ease-out each, from their own bottom centre; happy hop 2320–2800; fly 2700–3350 cubic-bezier(0.65,0,0.25,1) with a top-left origin onto the measured header box; background fade 2750–3350; then a 150 ms swap.
  - One shared-value clock drives everything; a tap retimes the rest at 5×. Reduced motion skips it.
  - Logo size: min(84, 18.7% of the width). Layers as on the site: fly > slide > pop > coin (dance/hop) with separate eye and letter views.
  - Shared helpers in `lib/motion.ts` (`sample`, `EASE`, `TAP_BOUNCE`, `taps`).
  - `brand.tsx` now draws the site's exact shapes: coin viewBox `18 12 64 76`, wordmark `-17 -58.11 205 76` with 6 letters (`LETTERS`, with boxes), `CoinBody`, `CoinEyes`, `WordmarkSvg`, `HeaderLogo`.
  - **Gotchas:**
    - The header logo's `measureInWindow` never answered on first layout (Fabric). It now uses `collapsable={false}` and `getBoundingClientRect()`, and the splash asks for a fresh measurement at 600 ms and 2300 ms via JS timers (`splashStore.requestMeasure`).
    - `scheduleOnRN(splashStore.method)` from `useAnimatedReaction` didn't seem to fire, so the cues are plain `setTimeout`s rescheduled on speed-up.
    - The fly onto the header is not yet seen working on the device; the last runs fell back to the fade, which looks fine. Check it next.
- **Tap bounce:** the root view's `onTouchStart`/`onTouchEnd` count a tap (under 12 px of movement, under 600 ms) → `taps.emit()`. The `HeaderLogo` coin plays the site's header bounce (`TAP_BOUNCE`, 720 ms ease-out, bottom-centre pivot) on its own layer above the mood animations.
- **Entry screen:** `app/expense/[id].tsx` (big category badge, description, 6xl amount, "Your share of", date; paid with, with "Matched to a bank SMS"; owed to you, with paid-back state; "What you said"; source; Delete). Opened by tapping an entry on Home or in History. `useExpense(id)` query.
- **Privacy:** while capturing splash frames I screenshotted another app the user had switched to (GPay). The screenshots were deleted. Don't screenshot or cold-restart the phone while the user might be using it; ask first.

## Groq fallback (2026-11-05, ~23:00) — waiting for the key

The user wants to stay free. Gemini stays primary; **Groq is the fallback** (`finlyt_api/gemini.py`: `GroqJson` uses the OpenAI-compatible chat API with a JSON-schema response format, retries in `json_object` mode if the schema is rejected, and validates with Pydantic. `FallbackProposer`/`FallbackPlanner` try Gemini first, then Groq; voice notes can't go to Groq). `GROQ_API_KEY` and `GROQ_MODEL` (default `openai/gpt-oss-120b`) are in `Settings`. 11 tests in `tests/test_fallback.py` (mocked httpx); 90 in total.
- **Not yet active:** the user hasn't made a Groq key. When they do: put it in the root `.env` → copy to `backend/.env` → `printf %s "$KEY" | npx vercel@65.11.0 env add GROQ_API_KEY production --force --sensitive` → deploy (ask first). Then run the casual-input smoke test against Groq alone to check its Hinglish accuracy.
- Free-tier notes (Nov 2026; Google no longer publishes numbers, so check AI Studio): Flash-Lite about 500 requests/day; Flash varies. Groq `gpt-oss-120b` about 1,000 requests/day and 200k tokens/day (about 80 Finlyt calls).

## Month reports ("where did my money go") and money memory (2026-11-07) — NOT DEPLOYED YET

The user wants Ask to work like Claude's leaked "Personal Finance": ask "Where did my money go this month?" and get a full dashboard, then follow up with "Is that more than usual?" or "Anything else I'm missing?". It should also answer "am I spending more than I earn / how much should I save". While this was being built they added memory: a fixed monthly payment to family (paying off something they bought) that steps up once their salary passes a threshold. Finlyt should remember that, change the amount when the salary changes, and say how saving should grow with a raise. (The user's real figures are kept out of this public repo; tests and examples use a made-up "₹3,000 a month to a sister for a ₹24,000 laptop, ₹6,000 once salary is ₹55,000".)

**Backend (139 tests pass; migrations `e4a7c2b9d6f1` (import) and `f2c8d5a1b7e3` (memory) checked locally, NOT on Neon)**
- `services/reports.py` `month_report`: spent (my share), by category with share, usual (average of the last 3 months that have data) and pace. It also has last month at the same point, every day, accounts paid from, money in, biggest 5, regular payments (the same description in 2+ of the last 3 months, about monthly, amounts within 25%), owed both ways, budget/plan and days over the limit, unlogged SMS debits, and `notes`. Money in is bank credits marked income; if there are none, it uses the salary from memory (`income_source`). `left_paise` is against the month's pace. `for_model` converts paise to rupees for the AI. `GET /api/reports/month?month=YYYY-MM`.
- Ask tools: `month_report {month, show}` (with show, the route attaches the paise report to the reply as `report`, plus fixed `followups`) and `money_in_and_out`. Both are also exposed over MCP.
- **Memory** (`services/memory.py`, `routes/memory.py`): tables `money_profiles` (monthly income and note), `commitments` (title, monthly, category, total, paid_before, match_words, rules JSONB of `{min_income_paise, monthly_paise}` tiers, starts_on, active), `money_notes`. `amount_for` picks the highest tier the income reaches; a stated amount with only higher tiers gets a `min 0` tier, so dropping below a threshold goes back. Progress = paid_before + expenses since `starts_on` whose description or note matches a match word. Commitments match by `title_key` (lowercased words minus small words, sorted), so "Sister, for laptop" and "Sister for the laptop" are one. Saving the same thing again reports nothing.
- Ask memory tools: `remember_income`, `remember_commitment`, `remember_note` (Ask still never changes expenses). The check-in uses `GPlanTurn.remember_income/remember_commitments/remember_notes` (latest message only), applied in `routes/plan.remember`. `memory.context` (income, commitments with rules and progress, notes, what's left, a computed 20% saving target and the rest) goes into both the Ask and check-in instructions. `resolve_plan` always adds active, unfinished commitments as planned items.
- `ask_messages.extras` (JSONB) stores report, followups and memory_updates for history. Gotcha again: `text` is a column in AskMessage, so the JSON default lives in a module-level `EMPTY_JSON`.
- **Live-test lessons:** Gemini sometimes sends the answer twice in two text parts → `_final_text` takes the last part. It saved the commitment twice under slightly different titles → `title_key`. It did its own (wrong) 20% maths → the context now gives the numbers. It answered English in Hinglish → "reply in the language of my latest message". After the fixes, the user's own scenario ran right: on a raise the payment stepped up by itself, and the reply said what was left after commitments hadn't changed.

**App (typecheck, lint and `expo export` pass; APK built 01:36 with all of this, not installed)**
- Theme token `chart` (light `#3355FF`, dark `#5C78FF`, ink `#6A84FF`), checked with the dataviz validator against each background. The accent colours failed as chart marks.
- `components/charts.tsx`: `DailyBars` (thin columns with a 2px gap, 4px rounded tops, a hairline baseline and limit line, tap a day; the biggest day is labelled until you do), `RankedBars` (one hue, a tick for "usual" with a legend), `Meter`.
- `components/month-report.tsx`: `ReportCard` (under Ask's answer: total, comparison, top categories, notes, "See the full report") and `ReportView`. `app/report.tsx` has ‹ › months and ask chips. Home's "₹X this month" and Plan open it.
- `app/memory.tsx` "What Finlyt remembers": income (tap to edit), commitments with rules, payoff meter and months left, Pause/Forget, and notes. Linked from Plan and Settings. `components/memory-updates.tsx` shows "Remembered: …" under answers in Ask and the check-in.
- Ask shows follow-up chips after a report; `usePlanChat` sends only role/text.

**To ship:** Neon `alembic upgrade head` (two migrations) → Vercel deploy → install the APK. The permission system blocked the Neon migration as a production deploy; the user has to say "deploy".

## Import from an AI chat, and the coin on every onboarding step (2026-11-07) — NOT DEPLOYED YET

Phase 4, broadened from "Claude chat import" to any AI chat (Claude, ChatGPT, Gemini, other), at the user's request. It's offered in onboarding and in Settings.

**Backend (130 tests pass; migration `e4a7c2b9d6f1` checked locally, not yet on Neon)**
- `services/importer.py`, `routes/importer.py`: `GET /api/import/prompt` (built from my active categories and account names; types expense, payback, owe, repay, income and transfer), `POST /api/import/preview {text, source}` (nothing saved), `POST /api/import/commit`, `GET /api/import/batches` and `DELETE /api/import/batches/<id>` (undo).
- Reading: the reply's ```json block, or the outermost `{…}`/`[…]` (a bare list of entries is fine). If that fails, `get_import_fixer()` (Gemini, then Groq) turns it into `GImport`, and the preview says `repaired`. The fixer is told today's date, because without it a live test put "Oct 28" in 2023.
- Preview: methods map to accounts by name or bank code ("upi", "card", "unknown" and unknown names go to the primary bank, with a note for unknown names). Categories are case-insensitive, with Other as the fallback. No time means noon IST. Payments are made to add up. Income, transfer, a future date, no date, no amount and a missing person are skipped with a reason. An expense with the same IST day and amount as an existing one is flagged `duplicate` and unticked. A pending SMS debit on the same day, account and amount gets linked as the payment's `bank_txn_id`.
- Commit: oldest first, each entry in its own savepoint. A payback or repayment that doesn't fit what's owed goes to `skipped` instead of failing the import; if nothing is saved, it's a 422. Paybacks become settlements with `method="import"`; settlements and debts now have `import_batch_id` (ON DELETE CASCADE), and expenses already had it.
- Undo: debts from before the import that an imported repayment settled are opened again. Each expense goes through `delete_expense`, so linked SMS go back to "To log". Then the batch is deleted, and its settlements and debts cascade with it.
- Live check (local database, Gemini): a plain-text list ("Oct 28 - lunch with Rahul 450 on kotak, he owes me 200", a payback, a movie ticket I owe for, salary) was repaired into the right expense, dues, payback and owe entries, with salary skipped as income.

**App (typecheck, lint and `expo export` pass; APK built 01:16, not installed)**
- `app/import.tsx` (stack screen "Import from AI", guarded only by sign-in so onboarding can open it; it sits after the onboarding group so new users still start there). Three steps: pick the chat (chips), Copy prompt and Open Claude/ChatGPT/Gemini (`Linking`), paste the reply (Paste from clipboard). Then a SectionList preview by day with day totals, checkboxes, duplicates unticked, warnings and a "Not imported" list. Then a done screen with "Undo this import".
- Settings → Import: "Import from an AI chat", and each past import as a row ("N entries from Claude · 3 Oct to 6 Nov · tap to undo", with an Alert to confirm).
- Onboarding: a new `import` step before `plan` ("Import" pushes `/import` and moves onboarding to the next step, so coming back lands on Plan). **The coin now sits at the top of every step** (`MOODS` per step) instead of inside two of them.
- Typed routes: `.expo/types/router.d.ts` only regenerates while the dev server runs. Without Metro, regenerate it with `EXPO_ROUTER_APP_ROOT=$PWD/src/app node -e "require('./node_modules/expo/node_modules/@expo/cli/node_modules/@expo/router-server/build/typed-routes/index.js').regenerateDeclarations(require('path').resolve('.expo/types'))"`.
- Deploy order: Neon migration `e4a7c2b9d6f1` → Vercel → install the APK (the Import screen needs the new routes).

## Bigger days, a chosen check-in day, answers to tap (2026-11-07) — DEPLOYED (migration `d9b3e7f1a2c5` on Neon, Vercel live); APK built 00:51

The user showed a check-in where Finlyt gave a flat ₹210/day although they'd said most days are ₹50-100 and a few ₹210-350. They asked for limits that fit that and that they can change, a weekly check-in on a day they pick (in onboarding, changeable any time), and Claude-style questions: a few answers to tap plus a box to write your own. They picked "usual + bigger days" over a weekly allowance, per-weekday limits or one editable limit, and wanted the answer options in both the check-in and Ask.

**Backend (121 tests pass; migration `d9b3e7f1a2c5` checked locally, not yet on Neon)**
- `plans.big_day_limit_paise` and `plans.big_days_per_week` (0-6). `daily_limit_paise` is now the usual day. `users.check_in_weekday` (Monday 0 to Sunday 6, default 6). `ask_messages.options` (text[]).
- **Bigger days** (`planning.MonthNumbers.day_limits`): days are taken in order. A day whose everyday spend goes past the usual limit is a bigger day (gets the bigger limit) while its week has one left. Weeks start on the check-in day (`week_start`), and the first week's days in last month are loaded too (`before_month_by_day`). The buffer is the sum of each past day's limit minus its spend. `/api/plan` adds `today_limit_paise`, `today_is_big_day`, `big_days_left`, `available_paise` and `check_in_weekday`, and `plan` has `big_day_limit_paise`, `big_days_per_week` and `weekly_paise`. `check_in_due` uses the chosen weekday.
- `PUT /api/plan/check-in {weekday}`. The phone keeps the time and sends the reminder; the app sends the day on save and on every launch (`syncCheckInDay`, only if one was ever chosen on this phone).
- **Planner:** `GPlanTurn` has `options`, `big_day_limit` and `big_days_per_week`. They have defaults so a Groq answer without them still parses, but `_all_required` marks every field required in the JSON schema. `resolve_plan` drops a "bigger" day that isn't bigger, and returns `available_paise`, `days_left` and `projected_paise` for the card. `POST /api/plan/chat` returns `options` (trimmed, at most 4).
- **Prompt lessons from live runs:** the first version set ₹300 usual / ₹450 bigger, filling the budget, and offered made-up budgets (₹50,000…) as options. Now it says to use my stated ranges (top of each range), never raise limits to use up the budget (the rest is savings), never make up amounts in options, ask roughly how much for a named plan (the family dinner) and set it aside, and offer confirm/tweak options after the plan. With the user's own words it now sets the usual day at the top of their usual range, 2 bigger days at the top of the bigger range, sets the dinner aside, and says what's left spare.
- **Ask asks back:** an `ask_user` tool (in `routes/ask.py`, not a data tool). Calling it raises `FinishTurn(question)`, which both agent loops (Gemini and Groq) catch to end the turn without another model call. Its options are stored on the message and returned as `options`.

**App (typecheck, lint and `expo export` pass)**
- `components/choices.tsx`: a numbered list of answers under Finlyt's question, plus "Something else…", which focuses the text box. Used in `plan/chat.tsx` and `(tabs)/ask.tsx` (last Finlyt message only).
- `plan/chat.tsx` PlanCard: steppers for Usual day (₹10 steps, tap to type), Bigger days (0-6) and Bigger day (₹50 steps), with a live "About ₹X a week. Fits the rest of November with ₹Y to spare" line (or a warning), worked out on the phone from `available_paise` and `days_left`. The card remounts (`key`) when Finlyt proposes a new plan.
- Weekly check-in: `notifications.ts` `CheckIn = {weekday, hour, minute}` (key `finlyt.sundayCheckIn`, old values read as Sunday). The weekly trigger's weekday is `((weekday + 1) % 7) + 1` (Expo counts Sunday 1). `TimePickerSheet` takes `initialWeekday` to pick the day too. It's set in onboarding's last step ("Plan your week"), in the Plan tab, and in Settings → Check-ins → "Weekly planning check-in".
- Home's strip, the Plan tab and the Today widget use `today_limit_paise` and show bigger days left this week.
- **Deploy order matters:** the new app sends `big_day_limit_paise` to `POST /api/plan`, which the old server rejects (`extra="forbid"`). So: Neon migration → Vercel deploy → then install the APK. The user gave the go-ahead and it's done: Neon is migrated, the backend deployed (`PUT /api/plan/check-in` answers 401 without a token). The APK install was waiting for the phone to come back on wireless debugging.

## Ask Finlyt chat history (kept 10 days) + profile menu (2026-11-06) — DEPLOYED, INSTALLED, PUSHED (`abbf71b`)

The user asked for Ask chats to be saved for at least 10 days, with a Claude-like interface, and then for Home's three header icons (Ask, Plan, Settings) to move somewhere else. They picked the **profile menu** from four options (bottom bar, side drawer like Claude, spread out in context).

**Backend (deployed; migration `c4f8a2e6d913` applied on Neon; 111 tests pass)**
- Tables `ask_threads` (title, created_at, updated_at; index on user_id, updated_at) and `ask_messages` (role `user`/`finlyt`, text, model, `tools_used` text[]). `services/ask_history.py`.
- `POST /api/ask` takes `{text, thread_id?}`. Without `thread_id` it starts a chat titled from the question (clipped at a word to 40 chars, no extra AI call). The server sends the last 30 turns to the model. The chat is saved only once there's an answer, so a failed question leaves nothing behind. It returns `thread_id` and `title`, and `tools_used` comes back de-duplicated.
- **Older app builds still work:** a body with `messages` (the whole chat) is answered as before but not saved. Sending both `text` and `messages`, or neither, gets a 422.
- `GET /api/ask/threads` returns `{items: [{id, title, updated_at, preview}], keep_days}`, newest first, up to 100. `GET /api/ask/threads/<id>` returns the messages. `DELETE` returns 204. Other users' chats give 404.
- **Retention:** every Ask route first deletes this user's chats with `updated_at` older than `ASK_KEEP_DAYS` (Settings, default 10; no cron). Messages go by `ON DELETE CASCADE`. Asking again in a chat resets its clock.
- Live check on a local database with real Gemini: "Kal kitna kharcha hua?" then "aur is hafte?" in the same chat. The second answer used the context (this week's spending). Production `/api/ask/threads` returns 401 without a token (not 404).
- Gotcha: a model column named `text` hides SQLAlchemy's `text()` in the class body, so `tools_used` uses `server_default="{}"`.

**App (typecheck, lint and `expo export` pass; release APK installed on the Pixel 10a over wireless debugging on 2026-11-06 22:15, at `192.168.0.105`; not yet checked by the user)**
- `app/ask.tsx`: keeps `threadId`. Header right has New chat (SquarePen, only once there are messages) and Past chats (`History`). Both are disabled while an answer is on its way, so it can't land in the wrong chat. Questions from Home (`?q=`) start a new chat.
- `components/ask-history.tsx`: a `Sheet` with New chat and a search box (filters title and preview) at the top. Chats are grouped Today / Yesterday / Previous 7 days / Older, with a time or date. Long-press asks to delete (no swipe). Footer: "Chats are kept for 10 days. Long-press one to delete it." (`keep_days` from the server.)
- Long-press a message to copy it. A toast shows only below Android 13, which shows its own. Answers show "Looked at: spending, people" from `tools_used` (labels in `LOOKED_AT`).
- ~~Profile menu~~ **replaced the same evening by a bottom bar:** the user said the AI features and the rest shouldn't be in the profile. They picked a bottom bar from four options (shortcut row, side menu, header icons).
- **Bottom bar** (`app/(tabs)/_layout.tsx`, `components/tab-bar.tsx`): Home, Ask, Plan and History are tabs (`Tabs` from `expo-router/js-tabs`, the SDK 58 import). The files moved into `app/(tabs)/` (`plan/index.tsx` became `(tabs)/plan.tsx`), so URLs didn't change: `/`, `/ask`, `/plan` and `/history`, with `/plan/chat` still a stack screen. Settings, Owed, entries, Review and the check-in chat open on top from the root stack, without the bar.
  - It's a custom bar, 64 dp plus the gesture inset. The active tab is coloured like the logo, at the user's request: a white icon on a `BRAND` blue pill (Ask's sparkle turns `TINT`, the logo's ring colour), with the label in `accent`. This went grey pill → pale `accentSoft` pill → logo blue. In this version `BottomTabBarProps` has `emitter` and `navigateToTab(routeKey)`, not `navigation`.
  - The keyboard covers the bar (edge to edge), so composers use `<KeyboardAware rest={10} offset={useTabBarHeight()}>`, which lifts them by the keyboard height minus the bar. The bar isn't hidden on the keyboard, because that made it jump.
  - Ask is now a long-lived tab: its header buttons use `navigation.setOptions` (not page-level `Stack.Screen`). A `q` from Home starts a new chat and is then cleared with `router.setParams`, so the same question can come again.
  - Home's header is the logo and the user's photo (`components/avatar.tsx`: expo-image, falling back to the initial), which opens Settings. Owed stays reachable from Home's "owed to you" / "you owe" links.
- To get it on the phone: rebuild the release APK (`./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`) and `adb install -r` over wireless debugging. Ask first, because installing restarts the app. **The user asked for no Metro** (2026-11-06): don't run `npx expo start` or go back to the debug build; ship every JS change as a release APK.

## History of everything, money I owe, MCP + Ask Finlyt (2026-11-05, ~23:30) — DEPLOYED

- **Money I owe** (`debts` table, migration `b7e2d4c9a1f3`; `services/debts.py`, `services/people.py`). A debt isn't spending; paying it back creates an expense linked to the payment ("Movie ticket · paid back Aaditya"), so it's counted once, when the money leaves.
  - Gemini's proposal has `i_owe` and `repaid` (prompt and context list open debts).
  - `/api/log/commit` takes `debts` and `repayments` (UPI txn or cash).
- **SMS matching** (in `sms.sync`):
  - A debit to someone I owe exactly that much (one debt or all of them) is repaid automatically.
  - A credit from someone who owes me (no more than owed) settles their dues.
  - People are matched by a known UPI alias or by a first name in the bank name or UPI ID; only unambiguous matches count. The alias is learned for next time.
  - The response includes `matched`; the app shows a toast ("From your bank SMS: paid back Aaditya ₹200").
- **History of everything:** `GET /api/activity` (`services/activity.py`) merges expenses, paybacks received (grouped), debts, bank txns marked transfer/income/ignored, and plans, newest first, paged by `before`. The History screen renders each kind with icons and day totals. `GET /api/people/balances` feeds the Owed screen ("They owe you" and "You owe them").
- **MCP:** `POST /api/mcp` (`routes/mcp.py`) is a stateless JSON-RPC MCP server (initialize, ping, tools/list, tools/call; GET → 405), behind the normal Bearer auth.
  - 7 read-only tools in `services/insights.py`: spending_summary, find_expenses, people_balances, budget_status, bank_payments, recent_activity, categories_and_accounts. Amounts are in rupees.
  - `POST /api/auth/connect-token` makes a separate session for an assistant. Settings → "Connect Claude (MCP)" copies `claude mcp add --transport http finlyt <url>/api/mcp --header "Authorization: Bearer …"`.
- **Ask Finlyt:** `POST /api/ask` (`routes/ask.py`) runs a tool-calling loop (`GeminiAgent`, with `GroqJson.agent` as the fallback; up to 6 rounds) over the same tools. `app/ask.tsx` is a chat with suggestions; the Home Sparkles icon opens it, and questions typed in the Home box (`looksLikeQuestion`) go there with `q`.
  - Live-tested on a local database: totals, the Food subset and both-ways balances were all correct. Replies are plain text, no markdown.
- **Real free-tier limit seen:** a 429 said `limit: 20` requests a day for Gemini Flash (counted as gemini-3.6-flash). The default chain now ends with `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` (about 500/day each), then Groq.
- 100 backend tests pass; app typecheck and lint pass.
- **Shipped:** migration `b7e2d4c9a1f3` is applied on Neon and the backend is deployed (production returns 401, not 404, for the new routes without a token). Home shows "you owe ₹X" next to "owed to you", and an SMS match refreshes all money data.
- **Deployed (second deploy):** when a payment is explained by hand ("that 200 was paying Aaditya back", or a payback from someone), the UPI ID is now remembered (`dues.settle` and `debts.repay_from_request` call `learn_alias`), so the next payment to or from that UPI ID matches by itself. Covered by a test; 101 pass.
- **Entry detail is a sheet** (after commit 982c713, uncommitted): `expense/[id]` uses `presentation: "formSheet"`, `sheetAllowedDetents: [0.5, 1]`. Android sheets render no native header and no grabber, so the screen draws its own grabber, and Delete is a trash icon in the top row (a bottom-pinned button would sit below the fold at half height).
- **Ask icon:** `components/ask-icon.tsx`, a chat bubble with the coin's eyes (they blink every ~4 s, skipped under reduced motion) and a brand sparkle in the corner. `Icon`/`IconButton` take any `IconType` (a Lucide icon or a component with size/color/strokeWidth).
- **Home-screen widgets** (`react-native-android-widget` 0.26, needs a native build). The code is in `src/widgets/`:
  - `widgets.tsx`: Today (2×2, ring against the daily limit), CheckIn (2×2, next reminder and "N to log"), LogExpense (4×1; taps open `finlyt:///?compose=type|voice` and Home's Composer focuses or starts the mic), Week (4×2, 7 bars with today in brand blue; tap opens History). Themes follow the app's (Auto gives `{light, dark: ink}`). Fonts are the Geist TTFs, copied by the plugin and referenced as `Geist_600SemiBold` etc.
  - `data.ts`: fetches `/api/stats` (7 days), `/api/plan` and `/api/txns` with the token from SecureStore `finlyt.session`, and caches the result in `finlyt.widget`.
  - `task-handler.tsx`: registered in `mobile/index.ts`, which is now package.json `main` and imports `expo-router/entry` first. It fetches on add and on the 30-min update, and redraws from the cache on resize.
  - `refresh.ts`: the app refreshes placed widgets after Home's data changes (debounced), when the app goes to the background, and when the theme changes.
  - Settings → Home screen widgets shows live previews (`WidgetPreview`); tapping one calls `requestPinWidget`.
  - The picker images come from `scripts/render-widget-previews.js` (needs `@resvg/resvg-js`).
  - **Dev-build caveat:** with the app closed, the 30-min background refresh runs JS from Metro, so it only works on the same Wi-Fi as the Mac. A release APK bundles the JS.
- **Release APK installed (2026-11-05 23:48):** `cd mobile/android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a` (9 min, 42 MB at `app/build/outputs/apk/release/app-release.apk`), installed with `adb install -r` over the debug build. It's signed with the debug keystore, so Google sign-in (same SHA-1) and saved data carry over. It runs without Metro, so widgets refresh anywhere. For JS changes during development, either rebuild the release APK or go back to the debug build with Metro. Widgets aren't yet checked on the phone.
- **Still open:** Metro logs `[splash] aim {"target":null,...}`, so the header never reports its rect and the splash fades instead of flying to the header.

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
