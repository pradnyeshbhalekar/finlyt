# Finlyt: handoff

Paused on 2026-11-07: month reports, money memory, Import from AI, bigger days and the chosen check-in day are all deployed, pushed and on the phone. Bigger days and the chosen check-in day are deployed. Before that, 2026-11-06 and 2026-11-05. This file is the checkpoint to resume from.

**2026-11-10: SMS reading was removed** at the user's request (branch `ccr-0478f642-6c372n`, not deployed, no new APK yet). No `READ_SMS`, no `sms-reader` module, no `/api/sms/sync`, no SMS parsers or SMS auto-matching. Tables and old bank txns are kept; see plan.md → "SMS pipeline". To ship: deploy the backend (an old app build would get 404 from `/api/sms/sync` and log a warning, nothing worse) and rebuild the APK so the permission leaves the manifest (`expo prebuild --clean` first, since `android/` is generated). Older notes below that mention SMS are history. Backend tests: 135 pass; `test_goals.py::test_a_goal_with_money_put_towards_it` already failed before this change.

**2026-11-11: Finlyt 0.1.2 (version code 5), the build without SMS.** The branch was fast-forwarded onto local `main` (not pushed). No prebuild was needed: `READ_SMS` only came from the module's own manifest, and autolinking drops a module once its `expo-module.config.json` is gone (the leftover ignored `modules/sms-reader/android/build` folder was deleted too). Version bumped by hand in `app.json` and `android/app/build.gradle`. Two-ABI `assembleRelease` in 3m 27s, 57 MB, `mobile/release/Finlyt-0.1.2.apk`; aapt2 shows no `READ_SMS`; signed with the same debug key (SHA-1 5E:8F:…:F6:25). 0.1.2 also had a swipe-through slide tour; the user didn't want that, so 0.1.3 replaced it.

**2026-11-11 (evening): Finlyt 0.1.3 (version code 6), on the website, not on the Pixel.** The user asked for (1) a tour that goes through the real app instead of slides, (2) Auto = black on dark phones, light on light ones, (3) a coin that keeps smiling and going back to normal, (4) a better-looking sign-in and onboarding, all on the website too.
- **Guided tour** (`lib/tour.ts` store and steps, `components/tour.tsx`): `<TourTarget id>` wraps a real part of a screen and reports its rect (getBoundingClientRect, else measureInWindow; re-measured 60 ms and 380 ms after each step starts, and on layout; only rects measured in the current step's `round` are used). `<TourHost/>` in the root layout dims everything with an SVG even-odd path whose rounded hole slides between parts (Reanimated `useAnimatedProps` on `d`), rings the hole with a pulsing brand border, shows a note card under or over it (Back / Next / Skip, progress bars) and switches tabs itself with `router.navigate(route)`. Android back goes a step back. Stops: intro → `today` → `tiles` → `composer` → `logged` (Home) → `ask-box` (Ask) → `plan-main` (Plan, both the no-plan and the plan layout) → `tab-history` (the tab button) → `avatar` (Home) → done. A part that never reports within 1.5 s gets a centred note. Started by onboarding's `finish` (700 ms after `onboarded` flips; `thenPlan` goes on to `/plan/chat` at the end, otherwise "Log my first expense" sets `compose=type` on Home) and by Settings → How Finlyt works (`router.dismissTo("/")`, then start). `src/app/tour.tsx` (slides) is deleted.
- **Auto = Dark (black) in dark mode** (`resolveTheme`), the auto widget dark variant too, and the base dark launch colour is `#000000` (app.json expo-splash-screen `dark.backgroundColor`). That needed `CI=1 npx expo prebuild --platform android --no-install`, which cleared and recreated `android/` (version 0.1.3/6 came from app.json; same debug keystore, SHA-1 5E:8F:…:F6:25 checked with apksigner). Cold two-ABI build ~10 min.
- **Lively coin** (`lib/lively.ts`): one shared clock, 2.6 s normal then 1.5 s smile; `useLivelyMood` turns a resting "default" into "happy" during the smile. Used by `Coin` and `HeaderLogo` (which also does a small hop and tilt on each idle smile, not with reduced motion). Home no longer makes the coin sleepy; the empty states use the default (lively) coin. Reactions (happy on save, thinking while Gemini reads) still win.
- **Sign-in and onboarding redesign** (`components/hero-art.tsx`: `CoinHero` = the coin in three soft accent rings with Chai/Auto/Left-today chips bobbing around it; `ReminderPreview`; `PlanPreview`). Sign-in: logo, CoinHero, 40 pt headline, a line, three point chips, the Google pill, a small note. Onboarding: progress bars + "n of 5"; welcome = CoinHero + "Hi name" + 2×2 feature cards; check-ins = a reminder preview; saving = choice cards with a radio dot and a tiny preview (check card / Saved · Undo); import = Claude/ChatGPT/Gemini chips + numbered steps joined by a line; plan = PlanPreview + the check-in day row.
- Typecheck and lint clean, typed routes regenerated. **None of it has been seen on a device**: wireless debugging was off all session. Check first: the tour's spotlight positions (edge-to-edge window coordinates), `router.navigate` between tabs, the end-of-tour `setParams`, the sign-in hero on a small screen.
- **Website, pushed `73fdc62`:** 0.1.3 APK and config; dark-mode visitors default to black (index.html script and `lib/theme.js`); `Mark lively` (navbar logo, demo toast) swaps eyes and hops with CSS keyframes on the same 4.1 s clock; the demo phone takes the page theme (`PhoneFrame followTheme`); the install step mentions the tour.

**2026-11-11 (night): Finlyt 0.1.4 (version code 7), import brings the plan too.** The user: "the import chat should also import the plan, of the current week or month". The import prompt now says today's date and asks for `"plan"` (month, monthly_budget, weekly_budget, daily_limit, big_day_limit, big_days_per_week, planned_items, notes) or null, never invented. `GImport.plan` (`GImportPlan`, lenient like entries; `entries` can now be empty) also goes through the Gemini/Groq repair: a live run on a messy reply got ₹20k budget, ₹600/day, 2 bigger days at ₹1,000 and rent on the 5th. `importer.plan_preview` drops another month's plan (with a `plan_note`), turns a weekly budget into a daily limit (÷7), and with only a daily/weekly figure and no budget on file makes the month's budget = spent so far + daily × days left + planned items; then `planning.resolve_plan` (same checks and commitments as the check-in chat). Preview returns `plan` (+ `month`, `weekly_budget_paise`, `replaces`) and `plan_note`. Commit takes an optional `plan` (PlanIn) and saves it with `planning.commit_plan` (replaces this month's plan from today); entries may be empty (then no batch, `batch_id: null`); `plan_saved` in the result. Undo leaves the plan. 4 new tests in `test_import.py` (14 there; 139 of 140 overall, the stale goals test still fails). App: a "November's plan" card at the top of the import preview (tick to keep, "Replaces the plan you have for this month", budget / usual day / bigger days, set-aside items, issues), the button says "and the plan" or "Import the plan", the done screen says so, and only the entries can be undone. **Needs the backend deployed** (no migration) for the app's plan card to appear; an older server just doesn't send `plan`.

**Website (`~/Developer/finlyt-web`), pushed `5a2555f`:** the 0.1.2 APK and `config.js`; the hero demo (`LiveDemo.jsx`) is now the app's Home (today against a ₹650 limit, month and Owed tiles, a "Look right?" card with Edit/Save, Logged today, Saved · Undo toast, tab bar), driven by `parseLog` in `lib/parseExpense.js` (several spends, cash/UPI/card, "more in cash", "with X, he owes N", "1.2k"); every SMS claim is gone from the copy (index.html description, Hero, Features, How it works, the install step, FAQ, and widget names to match the app). The backend isn't redeployed; it doesn't need to be for 0.1.2, because `/api/txns` kept its URL. Not installed on the Pixel yet (wireless debugging was off). The failing goals test is a stale test, not an app bug: it pins `today_ist` to 2026-11-07, but the deposit's `created_at` is the real `now()`, so "saved this month" misses it on any later day. **`plan.md` holds the design, decisions and phase checklist. This file holds the current state, what to do next, and things learned the hard way.**

## Simpler logging and a tour with an overview (2026-11-12): 0.1.5, on the website

The user: a friend "is not at all able to use it"; make logging simple and have the tutorial give a big overview of everything in a good UI. Also told the user the likelier blocker: **the Google sign-in screen is in Testing mode, so only accounts on its tester list can sign in** (Google Cloud → Google Auth Platform → Audience: add the friend as a test user, or Publish the app; basic scopes need no review). The app's sign-in error now says so instead of "Google sign-in failed (code)" (`describeSignInError` default).
- **Logging:** the box on Home has a **+** at its start (`Composer onAddByHand`) that opens Add by hand. Above the box, until something's logged today, a row of **tappable examples** ("chai 40", "auto 120 cash", "groceries 850", "lunch 450 with Rahul, he owes 200") puts the words in the box and opens the keyboard (`router.setParams({compose: "type"})`). Before anything has ever been logged (`useExpenses({limit: 1})` is empty), Home shows **`components/first-steps.tsx`**: "Log your first expense", type it / say it / fill in a form (tappable), "The box is at the bottom of the screen". Otherwise the empty day says "Type it in the box below, tap the mic, or tap + for a form."
- **Tour v2** (`TOUR_VERSION = 2` in `lib/tour.ts`): step 0 is a **full-screen overview** (`Overview` in `components/tour.tsx`): "Everything in one minute", the 3 ways to log as rows, what happens next (per Check before saving), then a 2-column grid of Today, Owed, Plan, Ask, History, Goals, Reminders, Import; "Show me around" / "Skip the tour". Then 11 spotlight notes, each with an icon badge, "n of 11" and progress bars: composer, **mic** and **+** (new `TourTarget`s inside `Composer`), today, tiles, logged, Ask box, Plan, History tab, avatar. The end card recaps Type it / Say it / Fill a form. The scrim is a bit darker.
- **Shown once after the update** to people who already use Finlyt: `prefs.tourVersion` (default 0); Home starts the tour (`from: "update"`) 1.2 s after the launch splash when it's older than `TOUR_VERSION`, and marks it seen. Onboarding's finish sets it too, so new people get the tour only from onboarding. Bump `TOUR_VERSION` to show a changed tour again.
- Typecheck and lint clean. **Not seen on a device** (only 7.2 GB free, too little for an emulator). Check on the phone: the spotlight on the mic and +, the overview's height on a small screen, the examples row above the box with the keyboard up.

## Email through Brevo (2026-11-12): built, waiting for the Brevo key

The user chose **Brevo**, a **welcome email only for new users**, and **feedback** by email.
- **Backend (not deployed yet):** `finlyt_api/mailer.py` (`Email`, `BrevoMailer` → `POST https://api.brevo.com/v3/smtp/email` with the `api-key` header, 8 s timeout, `sandbox=True` adds `X-Sib-Sandbox: drop`; `get_mailer()` is None until `BREVO_API_KEY` and `MAIL_FROM` are set; tests use `app.extensions["finlyt.mailer"]`). `services/emails.py`: `welcome(user)` (subject "Welcome to Finlyt, {first name}", the coin from `finlyt.onrender.com/email/coin.png`, three tips, the import line, a button to the site, "reply to this email"; reply-to `FEEDBACK_TO`) and `send_welcome` (never raises), called in `routes/auth.py` only when `is_new_user` (so once per account, no migration needed). `feedback(...)` / `send_feedback` and `POST /api/feedback` (`FeedbackIn`: kind idea/problem/praise, message 2–4000 chars, app_version, device) email `FEEDBACK_TO` (or `MAIL_FROM`) with the user as reply-to; user text is escaped. Without mail set up it's a 503 `not_configured`. Settings: `BREVO_API_KEY`, `MAIL_FROM` (a sender verified in Brevo), `MAIL_FROM_NAME` (default Finlyt), `FEEDBACK_TO`. 6 tests in `tests/test_emails.py`; 145 of 146 pass (the stale goals test).
- **App 0.1.5 (version code 8):** Settings → More → Send feedback opens `components/feedback-sheet.tsx` (Idea / Problem / I like…, a text box, Send, then "Thank you!"); it sends the app version and "Model · Android N". **The entry only shows when `/api/meta` says `feedback: true`** (mail set up on the server), so an app shipped before Brevo has no dead button, and feedback appears by itself once the key is on Vercel.
- **Parked on 2026-11-12:** the user will make the Brevo account later. The code is pushed (with 0.1.5) but **the backend is not deployed**: production still runs the 0.1.4 server, which has no `/api/feedback` and no `feedback` in `/api/meta`, so 0.1.5 hides Send feedback. Deploy once the keys are on Vercel.
- **Website:** `public/email/coin.png` (the app icon at 144 px) for the emails, pushed with 0.1.5 (`9e3f3ce`).
- **To switch it on:** the user makes a free Brevo account, verifies a sender address (Senders & IP → Senders) and creates an API key (SMTP & API → API keys), then puts `BREVO_API_KEY` and `MAIL_FROM` (and `FEEDBACK_TO` if feedback should go elsewhere) in the repo-root `.env`. Copy them to `backend/.env` and to Vercel (`printf %s "$VALUE" | npx vercel@65.11.0 env add NAME production --sensitive`), send one sandbox test (`BrevoMailer(..., sandbox=True)`) and one real welcome to the user's own address, then deploy, publish 0.1.5 on the site with the coin image, and push.
- Ideas the user hasn't picked yet: a weekly summary on the check-in day, last month's report on the 1st, a nudge after 3 days without logging, goal milestones, "email me this month as CSV", a monthly who-owes-you list. Scheduled ones need Vercel Cron (Hobby: daily at most, which is enough).

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

## Stable APK 0.2.0, on the website (2026-11-07, ~20:00)

- `app.json`: version 0.2.0, android.versionCode 2 (prebuild again). Built `assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a` (~12 min, 57 MB) and copied to `mobile/release/Finlyt-0.2.0.apk` (git ignores `*.apk`). Still signed with the template's debug keystore (SHA-1 5E:8F:…:F6:25), so it installs over the phone's build and Google sign-in keeps working. A real release keystore would need its SHA-1 added as another Android OAuth client, and a reinstall.
- Website (`~/Developer/finlyt-web`, Vite + React, Render): the APK is at `public/downloads/finlyt-latest.apk` (what `APP.apkUrl` points at), and `src/config.js` has version 0.2.0, 57 MB and Android 7.0+ (minSdk 24, not 8.0). Pushed `f780f6d` (GitHub warns about files over 50 MB; the limit is 100 MB). Live: https://finlyt.onrender.com/downloads/finlyt-latest.apk serves 59,487,711 bytes. For the next version, overwrite the APK and update `config.js`; Git LFS or a GitHub release would stop the repo growing ~57 MB a version.
- Only Google OAuth test users can sign in (the consent screen is in Testing mode), even though anyone can download it.
- **0.2.1 (2026-11-09):** the date on every To log row. Version code 3. `mobile/android` is gitignored, so the bump was made by hand in both `app.json` and `android/app/build.gradle`, with no prebuild. The two-ABI build took 3m 18s with a warm cache (57 MB, `mobile/release/Finlyt-0.2.1.apk`). On the website: the APK was overwritten and `config.js` bumped. Not yet installed on the Pixel (wireless debugging was off).
- **0.1.1 (2026-11-09), version code 4:** the launch screen follows the app's theme (background and coin; see "The launch screen follows the app's theme"). The user asked for the version *name* 0.1.1, lower than 0.2.1; the version **code** still has to go up (3 → 4) or Android refuses to install it over 0.2.1. `mobile/release/Finlyt-0.1.1.apk`, on the website. The user said not to install it on the Pixel.

## The launch screen follows the app's theme (2026-11-07, ~14:00)

The user: "the splash screen should be the same as the theme currently being used". The animated intro (`components/splash.tsx`) already used `colors.bg`; the mismatch was Android's own launch screen, fixed at build time: light `#FAFAF9`, or on a dark phone navy `#0B1033` (Ink's colour), while the user's Dark theme is black.
- `plugins/with-splash-themes.js` (in app.json plugins): colours `splash_light/dark/ink` and styles `Theme.App.SplashScreen.Light/.Dark/.Ink` (parent `Theme.App.SplashScreen`, only `windowSplashScreenBackground` changed).
- `modules/splash-theme` (local Expo module, Kotlin): `SplashTheme.set("Light"|"Dark"|"Ink"|"Default")` → `activity.splashScreen.setSplashScreenTheme(id)` on Android 13+, which Android remembers for later launches. "Default" (the Auto theme) goes back to the base style, which follows the phone.
- `_layout.tsx` `Themed`: an effect calls it whenever the theme mode or resolved theme changes. The new theme shows from the next cold start.
- ~~The base dark launch colour is now black~~ **Fixed 2026-11-09:** Auto on a dark phone is **Ink** (`resolveTheme`), so the base dark launch colour is navy `#0B1033` (`expo-splash-screen` dark backgroundColor). It was black, so Auto users saw a black launch screen and then a navy app.
- **Also fixed 2026-11-09: the coin follows the app's theme.** Android picks `drawable` vs `drawable-night` by the phone's dark mode, so Light on a dark phone gave a white coin on paper (almost invisible), and Dark/Ink on a light phone a blue coin. The plugin now writes `splashscreen_logo_light/dark.png` (same sizes as expo-splash-screen: 288 dp canvas, `imageWidth` from its options, made with `@expo/image-utils`) and each themed style sets `windowSplashScreenAnimatedIcon` too. Prebuild cleared and recreated `android/` again. Not yet seen on the phone; the first cold start after installing still uses the old choice, since the app sets the style when it runs.
- This needed `npx expo prebuild --platform android` (it cleared and recreated android/). The template's debug keystore is fixed, so the signing SHA-1 (and Google sign-in) stay the same; it was checked in the build log.

## Our own confirm sheets; savings goals (2026-11-07, ~13:50) — NOT DEPLOYED

- **No Android dialogs:** `lib/ask-sheet.ts` (`askSheet({title, message, actions})`, `confirmDelete(title, message, onConfirm, label)`) plus a single `<AskSheetHost />` in the root layout: a bottom sheet (trash icon for deletes, full-width buttons, red for destructive, Cancel). All 8 `Alert.alert`s were replaced (entry delete on Home, History and the entry screen; duplicates; undo import; forget commitment; delete chat; the To log actions). Files with a local `confirmDelete` import it as `askDelete`.
- **Savings goals** (migration `a6d1f4c8e2b0`, checked locally, not on Neon): `goals` (name, target, due_on, archived) and `goal_deposits` (± amount, note). `services/goals.py`: saved = Σ deposits (can't go below 0), left, progress, `months_until` (this month counts), `monthly_needed` (rounded up to ₹10), saved this month. Routes `/api/goals` (GET/POST), `/api/goals/<id>` (GET/PATCH/DELETE; `due_on: null` clears it), `/api/goals/<id>/deposits`. Goals go into `memory.context` ("Saving for Goa trip: ₹0 of ₹15,000, by 20 Dec 2026, about ₹7,500 a month"), so Ask and the check-in see them. Ask's `save_goal` tool creates or updates one by name. 148 tests pass (4 in `test_goals.py`).
- App: `app/goals.tsx` (cards with a meter, "New goal" → `components/goal-form.tsx` sheet: name, amount, month chips or "No date"; `?new=1` opens it), `app/goal/[id].tsx` (a Ring with saved of target, the `lib/goals.goalNote` line, Add money / Take out sheet with a note, the money in and out list, Change the goal, Delete via the confirm sheet). The Plan tab has a "Savings goals" card (each goal and New goal); Settings → Your money → Savings goals.
- **Needs:** Neon migration + Vercel deploy (goals), then install.

## Dates in History and To log (2026-11-07, ~13:35)

- `dates.dayHeading` ("Today · 7 Nov", "Yesterday · 6 Nov", "Thu, 5 Nov") for the day headings in History, a category's entries, the Import preview and Possible duplicates. `dates.dateTimeLabel` ("Today 8 Nov, 10:13 pm", "Yesterday 7 Nov, 8:00 pm", "Thu 5 Nov, 9:40 pm"; the date is always shown since 2026-11-08, at the user's request) for To log rows, which can be up to 14 days old.

## The logo on every tab, no MCP in Settings, a tappable Plan (2026-11-07, ~13:25)

- Tabs header (`(tabs)/_layout.tsx`): `headerTitle` is the logo (`components/tab-header.tsx` `TabLogo` = `HeaderLogo` 26, not the splash target), left-aligned, with `HeaderAvatar` on the right (opens Settings). Ask's own header buttons replace the avatar. Home keeps its own header.
- Settings: "Connect Claude (MCP)" removed, along with `useConnectToken`. The backend `/api/mcp` and `/api/auth/connect-token` are still there.
- `components/group.tsx`: `Group`, `GroupItem` (icon or `leading`, chevron when tappable, hairlines) and `GroupLabel`, shared by Settings and Plan.
- Plan: Today is a tappable card (chevron) → a "Your limits" sheet (usual day, bigger days, spent today, "Change them with Finlyt" → /plan/chat). The tiles are tappable (the budget tile → /report; saved/over plan → a sheet explaining the buffer). Set-aside items are a grouped card → a sheet (amount, due, progress bar, "Change it in a check-in"). The More links are a grouped card with chevrons.

## Cleaner Ask, Settings and answer options; logging on the right day (2026-11-07, ~13:10)

- **Answers to tap** (`components/choices.tsx`, used by Ask and the check-in): plain rounded pills (no numbers, box or chevrons) and a quiet "Type my own". `inset` (default true) lines them up under the check-in's coin; Ask passes false.
- **Ask**: Finlyt's replies are plain text (no bubble or coin), the user's messages soft `bg-surface` bubbles, and "Looking into it…" while waiting. The "Looked at: …" lines are gone (`LOOKED_AT` removed). `ReportCard` and `MemoryUpdates` (`inset={false}`) sit flush.
- **Settings** rewritten as grouped cards (`Group`/`Item` with hairlines): Your money (report, memory, import with "N imports so far"), Logging (check before saving as a toggle row, add by hand), Reminders ("Daily reminders" opens a sheet with `ReminderEditor` and "Send a test"; Weekly check-in), More (widgets → new `app/widgets.tsx`, Connect Claude, replay the welcome), Sign out. Past imports with Undo moved to the bottom of the Import screen.
- **Yesterday's entry saved as today:** the AI reads "yesterday"/"kal" right (checked live: all came out 6 Nov); the user's note likely had no day, so it was saved now. The card you check before saving showed only the time. Now: `whenLabel` ("Yesterday, 8:00 pm"); `components/day-picker.tsx` `DayChips` (Today · Yesterday · Earlier… with a sheet of the last two weeks); the save card has DayChips to move its non-bank entries (`moveToDay` keeps the time but never goes past now); the entry screen has "Change date" (PATCH via the new `useUpdateExpense`), hidden for bank-SMS entries.

## Cleaner Plan and report, a ring, tappable categories (2026-11-07, ~12:50)

- **Duplicates confirmed** in the report's biggest spends: "Room rent for November ₹8,000" twice and "SIP in Nifty 50 index fund ₹2,000" twice on 1 Nov (from importing the same chat more than once). The History banner lists them; the user should delete one of each.
- Report top: `Ring` (charts.tsx; `accentSoft` track, `chart` fill, red when over, full) for the budget spent, with the total and "of ₹budget"/"₹X over budget" inside, then "N of M days" and the comparison. Below it, three small tiles: A day, On pace for, Usually. Without a budget it shows just the hero number. Asked whether a ring makes sense, I said yes for one ratio (budget used), not for days passed as well.
- "Where it went" rows are tappable (`RankedBars` rows take `onPress` and show a chevron) → `app/category.tsx?month&category_id&name` (the month's entries in that category by day, via `useExpenses({from,to,category_id})`). "N more" expands to all. The per-category "on pace" lines are gone, and the pace note is one short line.
- Plan: today first (amount left, big, one bar, a bigger-days line), then two `Stat` tiles (the month against the budget, and saved for surprises or over plan). The "Last check-in: …" note is gone.
- History: the instruction line is gone (the duplicates banner stays).

## A calmer Home (2026-11-07, ~12:40)

The user: "there are too much going on, keep everything clean". Home had: the check-in label, today's amount and "N to log", a month line (spent, budget, owed, you owe), the plan strip (bar, left today, bigger days left, buffer), the "November so far" card with 3 bars, To log, today's entries, the hint and the composer. Now (`components/home-summary.tsx`):
- `TodayHero`: "Today", the amount, one thin bar against today's limit, and one line ("₹65 left of today's ₹100" / "₹40 over"). Tapping it opens Plan.
- `SummaryTiles`: two quiet tiles. The month tile (spent; "of ₹budget" or "₹X over budget"; opens /report) and Owed (to you, plus "you owe ₹Y"; opens /owed).
- `CheckInNudge`: a slim row only when a check-in is due or there's no plan.
- To log shows 3 (plus a picked one) with "See all N"; the heading is "To log · N".
- Today's entries are headed "Logged today". The "Try: …" hint shows only before anything's logged today.
- Removed from Home (Plan and the report still have them): bigger days left, the buffer line, the category card. `plan-strip.tsx` and `month-glance.tsx` are deleted.

## UI review on the phone (2026-11-07, ~12:20)

Screenshots over adb (only when `mCurrentFocus` is com.finlyt.app; helper `scratchpad/screens/shot.sh <name> [deep-link]`, screenshots deleted after reading). Found and fixed:
- **"₹1,17,928.57 over your income at this pace"** on Home, and in the report "₹4,764.28 a day · on pace for ₹1,42,928.57", "Left −₹1,17,928.57, −472%": after 7 days, everything, rent (₹16,000) and investments included, was multiplied by 30/7. Now `reports.pace` counts one-offs once (categories Rent, Bills, Investments, Education, Travel and Gifts, or any single item ₹2,000+) and projects only everyday spending. The report returns `everyday_paise`/`one_off_paise`, and per-day and pace are whole rupees (`whole`). Home's card now says "N% of your ₹X income spent" (or "₹Y more than your income") from what's actually spent, with no projection. The report says "Over ₹X, more than your income" instead of negatives, and explains the pace line.
- Home's month line: "₹X this month, ₹Y over budget" in red when over (it said "₹33,350 of ₹10,545").
- "over the day's limit on 1 days" is now singular when it's 1.
- Ask wrote "₹-690". The prompt now says never to write a negative amount ("₹690 over"/"short"), and to use whole rupees for averages.
- **Overlapping imports:** Settings showed 3 imports from Claude (18 entries 27 Oct–6 Nov, 3 on 2 Nov, 17 entries 27 Oct–5 Nov), so there are likely duplicates (this may be why November shows ₹33,350). New `GET /api/expenses/duplicates` (`expenses.possible_duplicates`): the same IST day and total, at least one imported, not all from the same batch (two hand-logged ₹20 chais aren't flagged). History shows a warn banner "N possible duplicates… Review" → `app/duplicates.tsx`, which groups them with a delete per copy.
- Deployed, installed (12:33) and pushed (`54d7513`) at the user's "deploy it, install it and push it".

## Logging asked "what was the amount?" though a payment had it; bottom bar without the pill (2026-11-07, ~10:45)

- The user logged "ice cream from the medical shop" and got "What was the amount for the ice cream?", although the price was in their bank payment. I couldn't reproduce it locally (flash-lite linked the payment every time: tapped, untapped, and with a phone-number UPI payee). The prompt said "If something has no amount, leave it out and ask". Now: a picked transaction's amount is the amount; with none picked, use a fitting waiting one (payee matches the place, or the only recent debit); if several could fit, ask *which* by amount and time, never "how much?".
- Safety net, `proposals.use_picked_txn` (called in `routes/log.propose`): exactly one picked debit, a note with no digits, and a model answer with no entries at all → one expense for the whole payment. The description comes from the note, and the category from `quick_parse.category_for` (it prefers what was bought over `PLACE_WORDS` like medical, so ice cream is Food). Tests in `tests/test_log.py`.
- Bottom bar: the user said the pill looked bad. There's no pill now: the active icon (24, stroke 2.1) is `chart` blue and its label `accent`; the rest are grey.
- **Deployed and installed 10:54** at the user's "deploy it and install it" (this APK also has the import-gate fix). Not yet seen on screen: the notification shade was open, so no screenshot was taken.

## Fixes from driving the phone (2026-11-07, ~10:20)

After a fresh install the user went through onboarding into Import (3 entries imported). Found by screenshots over adb:
- **"Done" did nothing:** Import opened from onboarding had no screen behind it (no back arrow), so `router.back()` was a no-op. Now `leave()`: from onboarding it does `router.replace("/onboarding?step=plan")` (onboarding reads `step` and starts there), otherwise back if it can, else `/`. Done says "Continue" when opened from onboarding. The skip uses `leave()` too.
- **Import layout:** "Read the reply" (in a `KeyboardAware` footer) floated mid-screen over step 3 with the keyboard closed: a stale keyboard height after pasting on another Import screen. The button now sits in the page under the paste box, and `KeyboardAware` counts the keyboard only while `KeyboardState` is OPENING, OPEN or CLOSING.
- **Payback left out:** "Sneha paid back her share of the Barbeque Nation dinner: owes you ₹0". Most likely the payback had no time (so noon) and the dinner a 9 PM time the same day, so it was processed first. Not confirmed: the permission system blocked reading the production rows. Commit now saves expenses and owe entries first, then paybacks and repays. There's a test for exactly this. **Needs a Vercel deploy** (blocked as a production deploy until the user says "deploy"). The user's skipped payback still has to be added: undo and re-import, or say "Sneha paid back 800" on Home.
- **Import opened on launch, and Done looped:** with Import guarded only by sign-in, a signed-in but not-onboarded launch opened Import, not onboarding (Expo Router lands on the first reachable screen). Done then did `replace("/")`, which redirected back to Import: a loop the user hit. Now `lib/import-gate.ts`: during onboarding, Import is reachable only after "Import from a chat" (`importGate.open()`, then the push on the next tick). Leaving closes it 600 ms after going back to onboarding. The guard is `signedIn && (prefs.onboarded || importOpen)`. **Test the signed-in, not-onboarded launch after any change to the root guards.**
- Unblocking the user before the fix: `adb shell am start -a android.intent.action.VIEW -d "finlyt:///onboarding" com.finlyt.app`.
- The import-order fix was deployed at the user's "deploy it" (~10:25).

## Making the new features findable (2026-11-07, after the deploy)

The user said they could only see Import from AI. Nothing was missing; it was all out of sight:
- The Plan tab without a saved plan shows only "No plan yet", which hid the report, memory and check-in rows. They're now one `links` block shown in both states (and the time picker is one `picker`).
- Home only had a small "₹X this month" text link. Now `components/month-glance.tsx` is a "November so far" card under the plan strip: the total, last month at the same point, the top 3 categories with usual ticks, "See where it went" (→ /report), and "Add your income and monthly commitments" (→ /memory) until income is known. `useRefreshMoney` also refreshes `report` and `memory`, and Home's pull-to-refresh calls it.
- Settings has a "Your money" section right after Appearance: This month's report, What Finlyt remembers, Import from an AI chat, and past imports.
- Ask's suggestions now start with "Where did my money go this month?", "Am I saving enough?" and "Remember my salary and monthly commitments".

## Month reports ("where did my money go") and money memory (2026-11-07) — DEPLOYED, ON THE PHONE

The user wants Ask to work like Claude's leaked "Personal Finance": ask "Where did my money go this month?" and get a full dashboard, then follow up with "Is that more than usual?" or "Anything else I'm missing?". It should also answer "am I spending more than I earn / how much should I save". While this was being built they added memory: a fixed monthly payment to family (paying off something they bought) that steps up once their salary passes a threshold. Finlyt should remember that, change the amount when the salary changes, and say how saving should grow with a raise. (The user's real figures are kept out of this public repo; tests and examples use a made-up "₹3,000 a month to a sister for a ₹24,000 laptop, ₹6,000 once salary is ₹55,000".)

**Backend (139 tests pass; migrations `e4a7c2b9d6f1` (import) and `f2c8d5a1b7e3` (memory) checked locally, NOT on Neon)**
- `services/reports.py` `month_report`: spent (my share), by category with share, usual (average of the last 3 months that have data) and pace. It also has last month at the same point, every day, accounts paid from, money in, biggest 5, regular payments (the same description in 2+ of the last 3 months, about monthly, amounts within 25%), owed both ways, budget/plan and days over the limit, unlogged SMS debits, and `notes`. Money in is bank credits marked income; if there are none, it uses the salary from memory (`income_source`). `left_paise` is against the month's pace. `for_model` converts paise to rupees for the AI. `GET /api/reports/month?month=YYYY-MM`.
- Ask tools: `month_report {month, show}` (with show, the route attaches the paise report to the reply as `report`, plus fixed `followups`) and `money_in_and_out`. Both are also exposed over MCP.
- **Memory** (`services/memory.py`, `routes/memory.py`): tables `money_profiles` (monthly income and note), `commitments` (title, monthly, category, total, paid_before, match_words, rules JSONB of `{min_income_paise, monthly_paise}` tiers, starts_on, active), `money_notes`. `amount_for` picks the highest tier the income reaches; a stated amount with only higher tiers gets a `min 0` tier, so dropping below a threshold goes back. Progress = paid_before + expenses since `starts_on` whose description or note matches a match word. Commitments match by `title_key` (lowercased words minus small words, sorted), so "Sister, for laptop" and "Sister for the laptop" are one. Saving the same thing again reports nothing.
- Ask memory tools: `remember_income`, `remember_commitment`, `remember_note` (Ask still never changes expenses). The check-in uses `GPlanTurn.remember_income/remember_commitments/remember_notes` (latest message only), applied in `routes/plan.remember`. `memory.context` (income, commitments with rules and progress, notes, what's left, a computed 20% saving target and the rest) goes into both the Ask and check-in instructions. `resolve_plan` always adds active, unfinished commitments as planned items.
- `ask_messages.extras` (JSONB) stores report, followups and memory_updates for history. Gotcha again: `text` is a column in AskMessage, so the JSON default lives in a module-level `EMPTY_JSON`.
- **Live-test lessons:** Gemini sometimes sends the answer twice in two text parts → `_final_text` takes the last part. It saved the commitment twice under slightly different titles → `title_key`. It did its own (wrong) 20% maths → the context now gives the numbers. It answered English in Hinglish → "reply in the language of my latest message". After the fixes, the user's own scenario ran right: on a raise the payment stepped up by itself, and the reply said what was left after commitments hadn't changed.

**App (typecheck, lint and `expo export` pass; APK rebuilt 01:45 and installed on the Pixel 01:46; pushed `a932951`)**
- Theme token `chart` (light `#3355FF`, dark `#5C78FF`, ink `#6A84FF`), checked with the dataviz validator against each background. The accent colours failed as chart marks.
- `components/charts.tsx`: `DailyBars` (thin columns with a 2px gap, 4px rounded tops, a hairline baseline and limit line, tap a day; the biggest day is labelled until you do), `RankedBars` (one hue, a tick for "usual" with a legend), `Meter`.
- `components/month-report.tsx`: `ReportCard` (under Ask's answer: total, comparison, top categories, notes, "See the full report") and `ReportView`. `app/report.tsx` has ‹ › months and ask chips. Home's "₹X this month" and Plan open it.
- `app/memory.tsx` "What Finlyt remembers": income (tap to edit), commitments with rules, payoff meter and months left, Pause/Forget, and notes. Linked from Plan and Settings. `components/memory-updates.tsx` shows "Remembered: …" under answers in Ask and the check-in.
- Ask shows follow-up chips after a report; `usePlanChat` sends only role/text.

**Deployed 2026-11-07 ~02:00** at the user's "deploy it": Neon is at `f2c8d5a1b7e3` and Vercel is live. `/api/reports/month`, `/api/memory` and `/api/import/*` answer 401 without a token. (One `/api/import/batches` request right after the deploy gave Flask's 404, and the next gave 401: a cold instance, not a missing route.)
- **Import is optional** (user request): onboarding's step says so and offers "Import from a chat" or "Skip, I don't have one" (stacked). The Import screen opened from onboarding (`?from=onboarding`) has its own "Skip, I don't have one" (`router.back()`).

## Import from an AI chat, and the coin on every onboarding step (2026-11-07) — DEPLOYED, ON THE PHONE

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
