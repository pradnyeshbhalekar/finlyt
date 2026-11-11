# Finlyt: personal expense tracker

> Resuming? Read [`handoff.md`](handoff.md) first. It has the current state, next steps and gotchas.

Finlyt is an Android app. It reminds me to log spending three times a day. I tell it what I spent, by voice or text. Gemini turns that into categorised expenses, and the app stores them in Postgres.

## Decisions

| Area | Choice |
|---|---|
| Mobile | Expo SDK 58 with TypeScript, Expo Router, NativeWind 4 (Tailwind 3) and TanStack Query. It runs as a development build, because Expo Go can't load custom native code |
| Brand | From the **"Finlyt logo" design canvas** (claude.ai artifact `9jkeZFe3PyLqAkFGZvnvrW`, board "final logo"): a rolling coin with eyes, the app's agent. Brand `#3355FF` (Tailwind `primary`, shades 50–950), Ink `#0B1033` (`ink`/`secondary`: text and secondary buttons), Tint `#AEBBFF` (`tint`). Dark mode keeps black backgrounds; secondary elements flip to white. Raw values in `mobile/src/lib/theme.ts`; the coin (moods: default, happy, thinking, sleepy) and wordmark are SVG components in `mobile/src/components/brand.tsx`; icon PNGs come from `mobile/scripts/render-brand.js` |
| Backend | Flask 3, SQLAlchemy 2, Alembic, Pydantic 2, `google-auth` and `google-genai`, managed with uv on Python 3.12 |
| Hosting | Vercel Python runtime, region `sin1` (Singapore) |
| Database | Neon Postgres in AWS Singapore. The API uses the pooled URL and migrations use the direct URL. A `dev` branch is used for local work |
| Sign-in | Google sign-in on the phone with the native account picker. The backend verifies the Google ID token, then issues its own 90-day session token, kept in expo-secure-store. Only emails in `ALLOWED_EMAILS` can sign in |
| Data | Every table is scoped per user, so the app can be shared later without a schema rewrite |
| AI | Gemini Flash through `google-genai`, structured JSON output. Models are tried in order until one answers: `gemini-3.5-flash` → `gemini-3.8-flash` → `gemini-2.5-flash` (the free tier often returns 503 "high demand"). `GEMINI_MODEL` overrides the list (comma-separated). If every Gemini model fails, **Groq** (`openai/gpt-oss-120b`, free tier, `GROQ_API_KEY`) answers instead, with the same prompt, schema and checks; text only. Simple notes skip AI entirely (quick parser) |
| Accounts | Kotak (primary, `X1234`), DNS Bank (Dombivli Nagari Sahakari Bank, `XX5678`) and Cash |
| Splits | Store the total paid, my share and who owes me. Paybacks are logged by saying so ("Rahul gave 200 back") |
| Input | Voice and text. Audio goes straight to Gemini, with no separate speech-to-text step |
| Reminders | Local notifications at 12:00, 18:00 and 23:00 IST, editable in Settings |
| Phone | Google Pixel 10a on the latest Android |

## How a day works

```
12:00 / 18:00 / 23:00   reminder (local notification)
        │ tap
        ▼
Log screen reads new Kotak/DNS SMS since last sync → backend parses them
   ₹450 → zomato@hdfcbank     Kotak   1:12 PM
   ₹120 → paytmqr…@paytm      Kotak   6:40 PM
        │
Voice: "zomato was lunch with Rahul, he owes me 200. the 120 was auto,
        plus 30 cash on top. chai 40 cash"
        ▼
Gemini → editable proposal → Save → Neon
   Lunch ₹450  Food       Kotak ₹450         share ₹250, Rahul owes ₹200
   Auto  ₹150  Transport  Kotak ₹120 + Cash ₹30
   Chai   ₹40  Food       Cash ₹40
```

When Rahul's ₹200 UPI credit arrives, the app asks "Rahul paying back for Lunch?" One tap settles it.

## Sign-in flow

1. The app calls `GoogleSignin.signIn()` with the **Web** OAuth client ID and gets back a Google ID token.
2. The app sends it to `POST /api/auth/google {id_token}`. The backend checks the token's signature, that its audience is `GOOGLE_WEB_CLIENT_ID`, and that the email is verified. It then checks the email against `ALLOWED_EMAILS`.
3. On first sign-in, the backend creates the user along with default categories and the Kotak, DNS Bank and Cash accounts.
4. The backend returns a random session token and stores only its SHA-256 hash. The token lasts 90 days, and the expiry extends while the app is in use.
5. Every API call sends `Authorization: Bearer <session token>`. Signing out deletes the session.

On Android, the free sign-in library uses Google's legacy Sign-In SDK. If Google retires it, we replace the library with a small local module built on Credential Manager (`androidx.credentials` + `googleid`), and nothing else changes.

## Data model

| Table | Holds |
|---|---|
| `users` | Google `sub`, email, name, picture, last login |
| `sessions` | Hashed session tokens, with expiry and a device label |
| `accounts` | Per user: Kotak, DNS Bank, Cash. Each has a name, kind (`bank`/`cash`), `bank_code` (which picks the SMS parser) and last 4 digits |
| `categories` | Per user: Food, Transport, Groceries, Fitness and so on, with emoji, colour and order (editable) |
| `sms_messages` | Raw bank SMS, deduplicated by hash and kept so parsers can be re-run |
| `bank_txns` | A parsed debit or credit: amount, channel, UPI ID or name, ref, time and account. Status is `pending`, `logged`, `transfer`, `payback`, `income`, `refund` or `ignored` |
| `expenses` | What the money was for: description, category, total paid, **my share**, my original words, and source (`log` / `manual` / `import`) |
| `expense_payments` | How it was paid: account and amount, optionally linked to a bank txn. Half cash means two rows |
| `people` | Names plus aliases (the UPI IDs and bank display names they pay from), learned from confirmed paybacks |
| `dues` | Who owes me how much, for which expense |
| `settlements` | Paybacks against dues, made by credit txn or cash. One credit can settle several dues |
| `import_batches` | Each Claude-chat import, so it can be undone |
| `ask_threads` · `ask_messages` | Ask Finlyt chats and their turns (with the model, data tools used, and answers to tap when Finlyt asked back). Deleted after `ASK_KEEP_DAYS` (10) without use |
| `money_profiles` · `commitments` · `money_notes` | What Finlyt remembers: monthly income; money promised every month (with income rules like ₹6,000 once salary is ₹55,000, and payoff progress); notes |
| `plans` | From each check-in: the usual-day limit, and optionally a bigger-day limit for N days a week. `users.check_in_weekday` is the check-in day; weeks start on it |

Invariants:

- Money is stored as integer paise (`*_paise BIGINT`). Times are `timestamptz`, and day boundaries use `Asia/Kolkata`.
- `expense.total = sum(payments)`.
- `expense.total = my_share + sum(dues)`.
  - Treating friends: no dues, and my share equals the total.
  - Lending ₹2,000: my share is 0 and there's a ₹2,000 due.
- The payment legs linked to a bank txn never add up to more than its amount.
- Every id in a request (account, category, txn, person) must belong to the signed-in user.
- Spend stats use my share. Per-account views use payments, which show what actually left Kotak, DNS or the wallet.

## API

All routes are under `/api` and use JSON. Every route needs `Authorization: Bearer <session>`, except `/api/health` and `/api/auth/google`. Amounts are integer paise.

| Method & path | Phase | Purpose |
|---|---|---|
| `GET /api/health` | 1 | Liveness check. Add `?db=1` to also ping the database |
| `POST /api/auth/google` | 1 | Exchange a Google ID token for a session |
| `GET /api/auth/me` · `POST /api/auth/logout` | 1 | Get the current user · end the session |
| `GET /api/meta` | 1 | Accounts, categories, people and the latest imported date |
| `GET /api/expenses` | 1 | List expenses. Filters: `from` and `to` (IST dates), `category_id`, `account_id`, `limit`, `offset` |
| `POST /api/expenses` | 1 | Add an expense manually, with payments and dues |
| `GET/PATCH/DELETE /api/expenses/:id` | 1 | Read, edit or delete an expense. Payments or dues sent with an edit replace the old ones. Deleting un-links any bank txns |
| `GET /api/stats` | 1 | Totals for a date range: spend, by category, by day, money out per account, open dues |
| `POST /api/log/propose` | 3 | Audio and/or text plus pending txn ids in, Gemini proposal and transcript out. Nothing is saved |
| `POST /api/log/commit` | 3 | Save a reviewed proposal in one database transaction |
| `GET /api/import/prompt` | 4 | The Claude prompt, built from the current categories and accounts |
| `POST /api/import/preview` | 4 | Pasted reply in, parsed entries and warnings out, plus `plan` (the chat's budget or plan for this month or week, checked like a check-in plan) or `plan_note` (why it can't come in). Gemini repairs bad JSON |
| `POST /api/import/commit` · `DELETE /api/import/:id` | 4 | Save an import as a batch, and `plan` (a `POST /api/plan` body) if it came along; entries can be empty when only the plan is imported · undo a batch (the plan stays) |
| `GET /api/txns` · `POST /api/txns/:id/resolve` | 5 | List pending txns · mark one as transfer, ignore or income |
| `GET /api/dues` · `POST /api/dues/settle` | 6 | What each person owes me · settle by cash or with a credit txn |
| `POST /api/ask` | — | Ask Finlyt: `{text, thread_id?}` in, answer and `thread_id` out. The chat is saved; older apps can send `messages` instead (not saved) |
| `GET /api/reports/month?month=` | — | The month report: by category vs usual, each day, money in and left, accounts, biggest, regular payments, owed, unlogged SMS |
| `GET /api/memory` · `PUT/DELETE /api/memory/income` · `POST/PATCH/DELETE /api/memory/commitments` · `DELETE /api/memory/notes/:id` | — | What Finlyt remembers, to see and correct |
| `PUT /api/plan/check-in` | 3b | The weekly check-in day (Monday 0 to Sunday 6). The time stays on the phone |
| `GET /api/ask/threads` · `GET/DELETE /api/ask/threads/:id` | — | Past chats (newest first, with `keep_days`) · one chat's messages · delete it. Chats untouched for 10 days are deleted on any Ask call |

## Screens

Redesigned on 2026-11-05 to be minimal: Lucide icons, Inter, and no emojis anywhere (notifications included). A bottom bar (Home, Ask, Plan, History) was added on 2026-11-06.

- **Sign in**: wordmark, one line of copy, "Continue with Google".
- **Onboarding** (first run after sign-in): "When should I check in?", with the reminder times (default 12:00, 18:00, 23:00; tap to change, X to remove, add more) and the "Check before saving" switch.
- **Bottom bar** (since 2026-11-06): Home, Ask, Plan and History are tabs. Settings, Owed, entries, Review and the check-in chat open on top without it.
- **Home** (where reminders land): wordmark and your photo, which opens Settings (your profile); the current check-in ("6 PM check-in"); today's spend (my share) and count; this month's total and a "₹X owed to you" link; today's entries; "All history". At the bottom: a "Try: …" hint and a chat-style composer. Type the way you talk (or record a voice note), then send.
  - **Check before saving on**: Gemini's entries appear in a card ("Look right?") with Save, Edit (opens the full editor) or discard (puts the words back in the composer).
  - **Off**: entries save straight away, and a toast offers Undo, which deletes them and puts the words back. Entries Gemini flags as not adding up are always shown for a check.
  - If Gemini finds nothing (e.g. "chai" with no amount), its question shows above the composer, with "Add it by hand instead".
- **Parsing**: simple notes ("chai 40 cash", "petrol 500 kotak, auto 120") are parsed by rules on the backend, instantly and with no AI. Only complex ones (people, splits, paybacks, times, extra amounts, unfamiliar words) go to Gemini. Voice is turned into text on the phone first, so it follows the same path.
- **Check entries** (`log/review`): the full editor, with description, category chips with icons, payment legs, who owes what, and an on/off switch per entry.
- **History**: entries grouped by day with day totals. Long-press to delete.
- **Owed to you**: total plus a per-person breakdown, worked out from open dues.
- **Check-in** (weekly, on the day and time you pick in onboarding, Plan or Settings): Finlyt asks what's coming up, with answers to tap or your own words. The plan has a usual-day limit and optional bigger days, and you can change the numbers on the card, which shows whether it fits the budget.
- **Ask Finlyt**: a chat about your money. If a question is unclear, Finlyt asks back with answers to tap. "Where did my money go?" comes with a report card (full report screen behind it) and follow-ups to tap. It remembers income, commitments and notes you tell it (the **What Finlyt remembers** screen shows them) and uses them for "am I saving enough?". Past chats sit behind the header's history icon (grouped by day, searchable, long-press to delete, kept 10 days), next to New chat. Long-press a message to copy it.
- **Settings**: profile; Appearance (Auto / Light / Dark / Ink); Check before saving; Add an entry by hand; Check-in times and a test reminder; How Finlyt works (the tour); Sign out.
- **Tour** (`lib/tour.ts`, `components/tour.tsx`): a guided walk through the real app. It lights up one part of Home, Ask, Plan and History at a time with a short note, after onboarding and from Settings → How Finlyt works.
- **Themes**: Auto is Light in light mode and Dark (black) in dark mode; Ink is a choice. The coin is always lively: normal, then a smile, over and over.

**Themes** (from the logo canvas): Light (white, ink text), Dark (black) and Ink (navy `#0B1033`). Auto follows the phone's light/dark setting. They're built on semantic Tailwind colours backed by CSS variables (`bg-bg`, `bg-surface`, `text-fg`, `text-muted`, `text-accent`…) set on the root view with NativeWind `vars()` (`src/lib/theme.ts`). Preferences (theme, check before saving, onboarded) are stored on the device in SecureStore (`finlyt.prefs`).

## SMS pipeline (phase 5): removed 2026-11-10

> **Removed at the user's request.** The app no longer asks for `READ_SMS` or reads any messages: `modules/sms-reader`, `src/lib/sms.ts`, the Home permission card and the onboarding step are gone, and so are `POST /api/sms/sync`, the parsers (`sms_parsers.py`, `banks.py`), `sms_filters` in `/api/meta` and the SMS auto-matching of paybacks (`debts.auto_repay`/`auto_payback`, `people.match_person`). The `sms_messages`/`bank_txns` tables and existing rows were kept (no migration), so `GET /api/txns`, `POST /api/txns/:id/resolve` (now `routes/txns.py`, `services/txns.py`), the "To log" list and links to old bank txns still work for data already there. `display_name` moved to `finlyt_api/counterparty.py`. The section below is history.

**On the phone:** a local Expo module, `mobile/modules/sms-reader` (Kotlin), queries `content://sms/inbox` for messages newer than the sync cursor. It keeps a message only if both of these are true:

- The sender is alphanumeric, not a phone number.
- The sender matches a bank pattern, or the body contains a bank marker. Kotak's sender pattern is `KOTAKB` and its marker is `Kotak Bank`. DNS Bank's sender ID is still unknown, so it's matched by the marker `-DNS Bank`.

It drops OTPs and posts the rest to `/api/sms/sync`. My other SMS never leave the phone.

**On the backend:**

1. Dedupe by hash.
2. Run the bank's regex parser, falling back to Gemini for unknown formats.
3. Store the result in `bank_txns` as `pending`.
4. Auto-link it to a payment I already logged that has no SMS yet, if the account, amount and day all match.

If the same ref arrives twice, the second copy is marked `duplicate`.

- Parsers live on the backend, so when a bank changes its SMS wording we redeploy Flask instead of rebuilding the app.
- ATM withdrawals and Kotak ↔ DNS transfers count as transfers, not spending.

Known formats, from real samples. Account digits, refs and counterparties are replaced with made-up values; test fixtures use made-up names and UPI IDs:

| Bank | Kind | Shape |
|---|---|---|
| Kotak | UPI debit | `Sent Rs.70.00 from Kotak Bank AC X1234 to <vpa> on 18-04-26.UPI Ref 600000000101. Not you, https://kotak.com/KBANKT/Fraud` |
| Kotak | UPI debit to a name | `Sent Rs.13.00 from Kotak Bank A/c X1234 to <NAME> on 04-11-26. UPI Ref 600000000202. Not done by you? Tap https://kotak.bank.in/KBANKT/Fraud` |
| Kotak | UPI credit | `Received Rs.1000.00 in your Kotak Bank AC X1234 from <vpa> on 22-07-26.UPI Ref:600000000303.` |
| DNS | Debit | `Your a/c no. XX5678 debited for Rs.9500.00 on 03-11-2026 19:24:08 trf to <vpa> (RefNo 600000000404). If not u? Call 18002331700-DNS Bank` |
| DNS | UPI credit | `Your a/c no. XX5678 is credited for Rs.9000.00 on 03-11-2026 19:26:47 and debited from VPA <vpa> (UPI Ref no 600000000505 )-DNS Bank` |

Parsing notes:

- The DNS credit message also says "debited from VPA", so the parser decides direction from the sentence structure, not from keywords.
- Kotak gives only a date (`dd-mm-yy`), so the time comes from when the SMS was received. DNS gives the full date and time.
- Kotak's counterparty can be a UPI ID or a name, and banks truncate both (for example `@hdfcban`).
- Still needed later (optional): sample SMS for Kotak debit card, ATM and NEFT/IMPS.

## Gemini logging (phase 3)

**Input:**

- Pending txns as short labels (`T1`, `T2`…), each with amount, time, direction, counterparty and account label
- The voice note (AAC) and/or text
- The category list and known people
- The current IST time

**Output:** JSON validated against a Pydantic schema, with these fields:

- `expenses[]`: description, category, time, total, my share, payments (a txn label, cash or an account) and dues
- `settlements[]`
- `transfers[]`
- `ignored[]`
- `questions[]`
- `transcript`

**Checks:** the backend confirms that each label exists and is still pending, that payments add up to the total, and that total = my share + dues. Anything that fails is flagged for review.

**As built (2026-11-05):**

- Gemini answers in rupees with names and labels (`finlyt_api/gemini.py`). `services/proposals.py` maps that to ids and paise. It keeps whatever doesn't add up but lists it in each card's `issues`: an unknown account goes to the primary account, an unknown category to Other, an over-assigned txn or a mismatched total or share is flagged. Total always equals the sum of the payment legs, and my share equals the total minus dues.
- `POST /api/log/propose` takes JSON `{text, txn_ids?}` or multipart (`audio` file as `audio/aac`, `text`, `txn_ids`). Audio is capped at 4 MB, under Vercel's 4.5 MB body limit. Without `txn_ids` it uses pending txns from the last 14 days.
- `POST /api/log/commit` takes `{expenses: ExpenseIn[], settlements, transfers: txn_ids, ignored: txn_ids}` and saves it all or nothing. Expenses get `source = log` and the transcript, or typed text, as `note_raw`.
- Paybacks (`services/dues.py`) settle that person's open dues oldest first. Paying back more than is owed is rejected. A credit txn used for a payback becomes `payback`. Phase 4 import and phase 6 reuse this.

**Privacy:** account numbers, balances and refs are never sent. On the free tier, Google may use prompts to improve its models. Enabling billing stops that, and should cost about $1 a month at this volume.

## Import from an AI chat (phase 4; built 2026-11-07, any AI chat, in onboarding and Settings)

1. On the Import screen, tap **Copy prompt** and paste it into the old Claude chat.
2. Paste Claude's reply back into the app.
3. The backend extracts the JSON code block and validates it. If Claude drifted from the format, Gemini repairs it.
4. The preview groups entries by day, with day totals. Then save.

How entries are handled:

- `expense` entries become expenses with payments and dues.
- `payback` entries settle that person's open dues, oldest first.
- `income` and `transfer` entries are shown in the preview but skipped.
- Each import is a batch that can be undone.
- The SMS start date defaults to the day after the newest imported entry, so nothing is counted twice.

Prompt (the app fills in the live category list):

```
I'm moving my expense tracking into an app. Go through this ENTIRE conversation, from the very first message, and pull out every expense and money movement I've told you about.

Reply with ONLY one JSON code block, nothing before or after it, in exactly this shape:

{
  "version": 1,
  "entries": [
    {
      "date": "2026-10-30",
      "time": "13:30",
      "type": "expense",
      "description": "Lunch at Zomato with Rahul",
      "category": "Food",
      "amount": 450,
      "my_share": 250,
      "payments": [{ "method": "kotak", "amount": 450 }],
      "owed_by": [{ "person": "Rahul", "amount": 200 }],
      "notes": ""
    }
  ]
}

Rules:
- One entry per item, oldest first. Don't merge items, skip small ones, or invent anything. If I gave you daily totals, list the individual items instead.
- date: YYYY-MM-DD. If I only said "today" or "yesterday", work out the real date from context. If unsure, give your best guess and write "date uncertain" in notes.
- time: "HH:MM" (24-hour) if known, otherwise null.
- amount: the full amount paid, as a plain number in rupees (no ₹, no commas).
- payments: how it was paid. method is one of "kotak", "dns", "cash", "upi" (bank unknown), "card", "unknown". The amounts must add up to amount. Half cash, half GPay from Kotak → [{"method": "kotak", "amount": 250}, {"method": "cash", "amount": 250}].
- my_share: my part if it was split, otherwise the same as amount. owed_by: who owes me what (empty list if nobody).
- type: "expense", "income", "payback" (someone returning money they owed me), or "transfer" (ATM withdrawal or moving money between my own accounts).
- category: one of Food, Groceries, Transport, Shopping, Bills, Rent, Fitness, Entertainment, Health, Personal care, Education, Travel, Gifts, Investments, Other.
- notes: anything else useful (e.g. who paid me back), otherwise "".
```

## Environment files

Real values never get committed. Only the `.env.example` files are in git.

**`backend/.env`** is for local development and points at the Neon `dev` branch. Set the same keys in the Vercel project, pointing at Neon `main`.

| Key | Where it comes from |
|---|---|
| `DATABASE_URL` | Neon → project → **Connect**, the pooled connection string (its host contains `-pooler`) |
| `DATABASE_URL_UNPOOLED` | The same dialog with connection pooling turned off. Alembic uses this one for migrations |
| `GOOGLE_WEB_CLIENT_ID` | Google Cloud → Google Auth Platform → Clients → the **Web application** client ID |
| `ALLOWED_EMAILS` | Comma-separated Google emails allowed to sign in (`*` lets anyone in) |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey (needed from phase 3) |
| `GEMINI_MODEL` | Optional comma-separated list of Gemini models to try in order. Default `gemini-3.5-flash,gemini-3.8-flash,gemini-2.5-flash` |

**`mobile/.env`**: `EXPO_PUBLIC_*` values are compiled into the app bundle, so they must not be secrets.

| Key | Value |
|---|---|
| `EXPO_PUBLIC_API_URL` | In development, `http://<Mac LAN IP>:5050`, or `http://localhost:5050` together with `adb reverse tcp:5050 tcp:5050`. After deploying, the Vercel URL |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | The same Web client ID as `GOOGLE_WEB_CLIENT_ID` |

## One-time setup

### Neon

1. Create a project named `finlyt` in the region **AWS Asia Pacific (Singapore)**. Postgres 17 is fine.
2. Create a `dev` branch from `main`. Put the `dev` pooled and direct URLs in `backend/.env`. The `main` URLs go into Vercel.
3. Run `cd backend && uv run alembic upgrade head` once against each branch.

### Google Cloud (sign-in)

1. Go to https://console.cloud.google.com and create a project named `Finlyt`.
2. Open **Google Auth Platform → Get started**. Set the app name to `Finlyt` and Audience to **External**. Add your Gmail under **Audience → Test users**. Testing mode is fine for personal use, because the app only asks for the basic `openid email profile` scopes.
3. Go to **Clients → Create client → Web application** and name it `Finlyt API`. Copy its client ID into both `GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. You don't need the client secret.
4. Go to **Clients → Create client → Android**. Enter the package `com.finlyt.app` and the SHA-1 of the signing key. For dev builds, that's the debug keystore that `expo prebuild` generates (React Native's standard debug key):

   ```
   5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
   ```

   To re-check it: `keytool -list -v -keystore mobile/android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep SHA1`

   There's nothing to copy from this client, because Google matches the app by package name and signature. A release build needs a second Android client with the release key's SHA-1. If the package or SHA-1 doesn't match, sign-in fails with `DEVELOPER_ERROR`.

### Vercel

Done on 2026-11-05: project `finlyt-api` (Hobby, team "pradnyeshbhalekar's projects"), region `sin1`, production URL **https://finlyt-api.vercel.app**.

1. `cd backend && npx vercel@65.11.0 login` (device-code flow), then `npx vercel@65.11.0 link --yes --project finlyt-api`. The link creates `backend/.vercel/` and `backend/.env.local` (OIDC token), both gitignored.
2. Production env: `DATABASE_URL` (pooled, secret), `GOOGLE_WEB_CLIENT_ID`, `ALLOWED_EMAILS`, `GEMINI_API_KEY` (secret). Add or replace one with `printf %s "$VALUE" | npx vercel@65.11.0 env add NAME production --force --sensitive`.
3. Deploy with `npx vercel@65.11.0 deploy --prod --yes` from `backend/`. It isn't connected to GitHub, so pushes don't deploy.
4. Logs: `npx vercel@65.11.0 logs requests --json`, or the dashboard.
5. Migrations run from the Mac (`uv run alembic upgrade head`, using `DATABASE_URL_UNPOOLED`). There's only one Neon database, so local dev and production share data.

### Phone

1. Turn on Developer options and USB debugging, then connect the phone to the Mac.
2. Install the app over USB with adb, not from a downloaded APK. (Play Protect used to block it while the app asked for SMS access; that permission is gone now.)
3. Set Finlyt's battery usage to Unrestricted.

## Gotchas

- Android builds need JDK 17, but this Mac defaults to 23. Run `export JAVA_HOME=$(/usr/libexec/java_home -v 17)` first.
- Use Node 22 via nvm (`nvm use` reads `.nvmrc`). The shell's default `node` is 20.18, which is too old for Expo SDK 58.
- The local backend runs on port 5050, because macOS AirPlay uses 5000.
- The app re-schedules reminders every time it opens. Android batches inexact alarms, so a reminder can arrive a few minutes late.

## Repo layout

```
finlyt/
├── plan.md
├── backend/              Flask API (deployed to Vercel)
│   ├── app.py            Vercel entrypoint: app = create_app()
│   ├── finlyt_api/       app factory, config, db, models, auth, schemas, routes/, services/
│   ├── migrations/       Alembic
│   └── tests/
└── mobile/               Expo app (Android), package com.finlyt.app
    ├── src/app/          Expo Router screens
    ├── src/lib/          API client, auth, notifications, money
    └── modules/splash-theme/ local Expo module (launch screen theme)
```

## Local development

- **Backend:** `cd backend && uv sync && uv run flask --app app run --host 0.0.0.0 --port 5050`
- **Migrations:** `uv run alembic upgrade head`. This uses `DATABASE_URL_UNPOOLED` if it's set, otherwise `DATABASE_URL`.
- **Tests:** `uv run pytest`. The DB tests need `TEST_DATABASE_URL` and are skipped without it.
- **App on the phone:** `cd mobile && npx expo run:android --device`

## Build order & status

- [x] **0. Setup**: git repo ✅ (github.com/pradnyeshbhalekar/finlyt), Android SDK ✅, env files ✅, scaffolds ✅, Neon ✅ (migrated), Google Web + Android clients ✅, Gemini key ✅, Vercel ✅
- [x] **1. Backend core**: models and migration ✅, Google sign-in and sessions ✅, per-user defaults ✅, meta, expenses and stats endpoints ✅, tests ✅, deployed to Vercel ✅ (https://finlyt-api.vercel.app)
- [x] **2. App shell**: sign-in screen ✅, navigation ✅, NativeWind ✅, 12/6/11 reminders ✅, manual add ✅, history ✅, home totals ✅, brand icon/splash/notification icon/logo ✅ (typecheck, lint and Android bundle pass). Installed on the Pixel and sign-in works ✅
- [x] **3. Gemini logging**: propose and commit endpoints ✅, paybacks ✅, 33 backend tests ✅, live Gemini check with text and an AAC voice note ✅, Log screen with recorder ✅, Review screen ✅, voice note → review → save works on the Pixel ✅
- [x] **3b. Weekly check-in planning**: monthly budget, planned items, daily limit and buffer; chat with Finlyt; Home strip; weekly reminder (deployed). 2026-11-07: usual + bigger days, check-in day of your choice, answers to tap, editable plan card (built, not deployed yet)
- [x] **4. Import from an AI chat** (Claude, ChatGPT, Gemini): prompt, preview with duplicates and SMS links, batch save, undo; onboarding step (optional, with a skip) and Settings (deployed 2026-11-07)
- [—] **5. SMS auto-fetch**: **removed 2026-11-10** at the user's request (see "SMS pipeline"). Existing bank txns and the "To log" list remain
- [ ] **6. Owed to me**: payback matching, charts, release APK

## Waiting on

Nothing right now.

Done 2026-11-05: Android OAuth client; dev build installed on the Pixel over wireless debugging; Google sign-in works on the phone.

Done 2026-11-05: Neon URL, Web client ID and Gemini key (in the root `.env`, copied into `backend/.env` and `mobile/.env`). `ALLOWED_EMAILS=*`, at the user's choice, because Google's Testing mode already limits sign-in to the test users.
