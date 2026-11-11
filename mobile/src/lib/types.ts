// Shapes returned by the Finlyt API. Amounts are integer paise; times are ISO strings in IST.

export type User = { id: number; email: string; name: string | null; picture_url: string | null };

export type Account = {
  id: number;
  name: string;
  kind: "bank" | "cash";
  bank_code: string | null;
  last4: string | null;
  is_primary: boolean;
};

export type Category = { id: number; name: string; emoji: string; color: string };

export type Person = { id: number; name: string };

export type Meta = {
  user: User;
  timezone: string;
  server_time: string;
  accounts: Account[];
  categories: Category[];
  people: Person[];
  latest_import_at: string | null;
};

export type Payment = {
  id: number;
  account_id: number;
  amount_paise: number;
  bank_txn_id: number | null;
};

export type Due = {
  id: number;
  person_id: number;
  person_name: string;
  amount_paise: number;
  settled_paise: number;
  status: "open" | "settled" | "written_off";
};

export type Expense = {
  id: number;
  occurred_at: string;
  description: string;
  category_id: number | null;
  total_paise: number;
  my_share_paise: number;
  note_raw: string | null;
  source: "log" | "manual" | "import";
  import_batch_id: number | null;
  payments: Payment[];
  dues: Due[];
  created_at: string;
  updated_at: string;
};

export type ExpenseList = { items: Expense[]; limit: number; offset: number };

export type Stats = {
  from: string;
  to: string;
  spend_paise: number;
  expense_count: number;
  by_category: { category_id: number | null; spend_paise: number; count: number }[];
  by_day: { day: string; spend_paise: number }[];
  by_account: { account_id: number; paid_paise: number }[];
  open_dues_paise: number;
};

export type NewExpense = {
  occurred_at: string;
  description: string;
  category_id: number | null;
  payments: { account_id: number; amount_paise: number; bank_txn_id?: number | null }[];
  dues: { person_name: string; amount_paise: number }[];
  note_raw?: string | null;
};

// ── Phase 3: voice/text logging ──────────────────────────────────────────────

/** A bank transaction waiting to be explained, labelled T1, T2… for Gemini. */
export type PendingTxn = {
  label: string;
  id: number;
  account_id: number;
  direction: "debit" | "credit";
  amount_paise: number;
  counterparty: string | null;
  occurred_at: string;
};

export type ProposedPayment = {
  account_id: number;
  amount_paise: number;
  bank_txn_id: number | null;
  txn_label: string | null;
};

/** Gemini's reading of one expense, already mapped to ids and paise. `issues` need a look. */
export type ProposedExpense = {
  occurred_at: string;
  description: string;
  category_id: number | null;
  total_paise: number;
  my_share_paise: number;
  payments: ProposedPayment[];
  dues: { person_name: string; amount_paise: number }[];
  issues: string[];
};

export type ProposedSettlement = {
  person_name: string;
  amount_paise: number;
  bank_txn_id: number | null;
  txn_label: string | null;
  owed_paise: number;
  issues: string[];
};

export type TxnNote = { bank_txn_id: number; txn_label: string; reason: string };

export type Proposal = {
  debts?: ProposedDebt[];
  repayments?: ProposedRepayment[];
  transcript: string;
  questions: string[];
  txns: PendingTxn[];
  expenses: ProposedExpense[];
  settlements: ProposedSettlement[];
  transfers: TxnNote[];
  ignored: TxnNote[];
  model: string;
};

export type LogCommit = {
  debts?: { person_name: string; amount_paise: number; description: string; category_id: number | null; note_raw?: string | null }[];
  repayments?: { person_name: string; amount_paise: number; bank_txn_id: number | null }[];
  expenses: NewExpense[];
  settlements: { person_name: string; amount_paise: number; bank_txn_id: number | null }[];
  transfers: number[];
  ignored: number[];
};

export type LogCommitResult = {
  expense_ids: number[];
  settlement_count: number;
  transfer_count: number;
  ignored_count: number;
};

// ── Planning: monthly budget, Sunday check-in, daily limit ──────────────────

export type PlannedItem = {
  id?: number;
  description: string;
  amount_paise: number;
  spent_paise?: number;
  due_on: string | null;
  category_id: number | null;
};

export type PlanStatus = {
  today: string;
  month: string;
  days_left: number;
  budget_paise: number | null;
  spent_month_paise: number;
  planned_total_paise: number;
  planned_left_paise: number;
  planned_items: PlannedItem[];
  plan: {
    starts_on: string;
    /** The usual day's limit. */
    daily_limit_paise: number;
    /** A few bigger days a week get this limit (null for one flat limit). */
    big_day_limit_paise: number | null;
    big_days_per_week: number;
    weekly_paise: number;
    notes: string | null;
  } | null;
  today_spent_paise: number;
  /** The usual limit, or the bigger one once today has gone past it and the week has one left. */
  today_limit_paise: number | null;
  today_is_big_day: boolean;
  /** Bigger days still left this week (null without bigger days). */
  big_days_left: number | null;
  /** Negative when over today's limit. Null without a plan. */
  today_left_paise: number | null;
  /** Kept aside from days under the limit, for unplanned things. */
  buffer_paise: number;
  available_paise: number | null;
  suggested_daily_limit_paise: number | null;
  /** The weekly check-in day, Monday 0 to Sunday 6. */
  check_in_weekday: number;
  check_in_due: boolean;
};

export type ProposedPlan = {
  monthly_budget_paise: number;
  daily_limit_paise: number;
  big_day_limit_paise: number | null;
  big_days_per_week: number;
  suggested_daily_limit_paise: number;
  /** What the budget leaves for everyday spending, and over how many days, to check the fit. */
  available_paise: number;
  days_left: number;
  planned_items: PlannedItem[];
  notes: string | null;
  issues: string[];
};

export type ChatMessage = { role: "user" | "finlyt"; text: string };

/** `options`: answers to tap when Finlyt asked a question (you can always type your own). */
export type PlanTurn = {
  reply: string;
  options: string[];
  plan: ProposedPlan | null;
  memory_updates?: MemoryUpdate[];
  model: string;
};

// ── Bank transactions ────────────────────────────────────────────────────────

/** A bank payment waiting to be explained. */
export type BankTxnItem = {
  id: number;
  account_id: number;
  direction: "debit" | "credit";
  amount_paise: number;
  channel: string;
  counterparty: string | null;
  /** Readable name, e.g. "Zomato" for zomato@hdfcbank. */
  name: string;
  occurred_at: string;
  status: string;
};

// ── People: owing both ways ──────────────────────────────────────────────────

export type ProposedDebt = {
  person_name: string;
  amount_paise: number;
  description: string;
  category_id: number | null;
  issues: string[];
};

export type ProposedRepayment = {
  person_name: string;
  amount_paise: number;
  bank_txn_id: number | null;
  txn_label: string | null;
  owed_paise: number;
  issues: string[];
};

export type Balances = {
  owed_to_me: { person_id: number; name: string; amount_paise: number; items: { description: string; amount_paise: number }[] }[];
  i_owe: { person_id: number; name: string; amount_paise: number; items: { description: string; amount_paise: number }[] }[];
};

// ── History: everything, newest first ────────────────────────────────────────

export type ActivityItem = { at: string } & (
  | { type: "expense"; expense: Expense }
  | { type: "payback"; person: string; amount_paise: number; method: string; for: string[] }
  | {
      type: "debt";
      id: number;
      person: string;
      amount_paise: number;
      description: string;
      category_id: number | null;
      status: "open" | "settled";
      settled_at: string | null;
    }
  | {
      type: "bank";
      id: number;
      status: "transfer" | "income" | "ignored";
      direction: "debit" | "credit";
      name: string;
      amount_paise: number;
      account_id: number;
    }
  | { type: "plan"; daily_limit_paise: number; notes: string | null }
);

export type ActivityPage = { items: ActivityItem[]; next_before: string | null };

// ── Ask Finlyt ───────────────────────────────────────────────────────────────

export type AskTurn = {
  thread_id: number;
  title: string;
  reply: string;
  /** Answers to tap when Finlyt asked a question back. */
  options: string[];
  /** A month report to show under the answer, with follow-up questions to tap. */
  report?: MonthReport | null;
  followups?: string[];
  /** What Finlyt remembered from this message. */
  memory_updates?: MemoryUpdate[];
  model: string;
  tools_used: string[];
};

/** A message in a saved chat. `tools_used` is what Finlyt looked at to answer. */
export type AskMessage = {
  id: number;
  role: "user" | "finlyt";
  text: string;
  tools_used: string[];
  options: string[];
  report?: MonthReport | null;
  followups?: string[];
  memory_updates?: MemoryUpdate[];
  created_at: string;
};

export type AskThreadSummary = { id: number; title: string; updated_at: string; preview: string };

export type AskThreadList = { items: AskThreadSummary[]; keep_days: number };

export type AskThread = { id: number; title: string; created_at: string; updated_at: string; messages: AskMessage[] };

// ── Import from an AI chat ───────────────────────────────────────────────────

export type ImportSource = "claude" | "chatgpt" | "gemini" | "other";

export type ImportEntry = {
  index: number;
  /** "skip" for income, transfers and entries that can't be saved (see skip_reason). */
  kind: "expense" | "payback" | "owe" | "repay" | "skip";
  skip_reason: string | null;
  occurred_at: string | null;
  day: string | null;
  description: string;
  category_id: number | null;
  amount_paise: number;
  my_share_paise: number | null;
  payments: { account_id: number; amount_paise: number; bank_txn_id: number | null }[];
  dues: { person_name: string; amount_paise: number }[];
  person_name: string | null;
  note_raw: string | null;
  warnings: string[];
  /** An expense on the same day for the same amount is already logged. */
  duplicate: boolean;
  include: boolean;
};

/** The chat's budget or plan for this month (a weekly budget comes as a daily limit). */
export type ImportedPlan = ProposedPlan & {
  /** "YYYY-MM": always this month. */
  month: string;
  weekly_budget_paise: number | null;
  /** This month already has a budget or plan, which this one replaces. */
  replaces: boolean;
};

export type ImportPreview = {
  source: ImportSource;
  /** The reply wasn't in the format, so the AI tidied it up. */
  repaired: boolean;
  entries: ImportEntry[];
  /** Older servers leave these out. */
  plan?: ImportedPlan | null;
  /** Why the chat's plan isn't coming in (another month, no budget), if it had one. */
  plan_note?: string | null;
  summary: {
    found: number;
    importable: number;
    duplicates: number;
    skipped: number;
    first_day: string | null;
    last_day: string | null;
    spent_paise: number;
  };
};

export type ImportResult = {
  /** Null when only the plan came in. */
  batch_id: number | null;
  imported: number;
  plan_saved?: boolean;
  saved: { expense: number; payback: number; owe: number; repay: number };
  skipped: { index: number; description: string; reason: string }[];
};

export type ImportBatch = {
  id: number;
  source: ImportSource;
  source_name: string;
  entry_count: number;
  created_at: string;
  first_day: string | null;
  last_day: string | null;
};

// ── Month reports and what Finlyt remembers ──────────────────────────────────

export type MonthReport = {
  month: string; // YYYY-MM
  label: string; // "November 2026"
  first_day: string;
  last_day: string;
  current: boolean;
  days_counted: number;
  days_in_month: number;
  spent_paise: number;
  entries: number;
  per_day_paise: number;
  /** Day-to-day spending, and one-offs (rent, bills, investments, anything ₹2,000+). */
  everyday_paise: number;
  one_off_paise: number;
  /** The month at today's rate: one-offs once, everyday spending projected (= spent for a past month). */
  pace_paise: number;
  last_month: { label: string; total_paise: number; same_point_paise: number };
  usual: { total_paise: number; months: number };
  categories: {
    category_id: number | null;
    name: string;
    spent_paise: number;
    entries: number;
    share: number;
    usual_paise: number | null;
    pace_paise: number;
  }[];
  by_day: { day: string; spent_paise: number }[];
  paid_from: { account_id: number; name: string; paid_paise: number }[];
  money_in: {
    income_paise: number;
    income_count: number;
    paybacks_paise: number;
    unexplained_credits: { count: number; paise: number };
    /** The monthly income Finlyt remembers (used when no bank credit is marked as income). */
    salary_paise: number | null;
    income_source: "bank" | "memory" | null;
    commitments_paise: number;
    /** Income left after spending, on pace for the current month. */
    left_paise: number | null;
    saved_share: number | null;
    /** Share of the month's income spent so far. */
    spent_share: number | null;
  };
  biggest: { expense_id: number; description: string; day: string; category: string; my_share_paise: number }[];
  regular: { description: string; category: string; typical_paise: number; months: number; last_day: string }[];
  owed: { to_me_paise: number; i_owe_paise: number };
  budget: {
    budget_paise: number | null;
    plan: PlanStatus["plan"];
    days_over_limit: number | null;
  };
  unlogged: { count: number; paise: number };
  notes: string[];
};

export type MemoryUpdate = { kind: "income" | "commitment" | "note"; text: string };

export type Commitment = {
  id: number;
  title: string;
  monthly_paise: number;
  category_id: number | null;
  category: string | null;
  total_paise: number | null;
  paid_paise: number;
  left_paise: number | null;
  months_left: number | null;
  done: boolean;
  rules: { min_income_paise: number; monthly_paise: number }[];
  match_words: string[];
  starts_on: string;
  active: boolean;
  notes: string | null;
};

export type MoneyMemory = {
  monthly_income_paise: number | null;
  income_note: string | null;
  committed_paise: number;
  after_commitments_paise: number | null;
  commitments: Commitment[];
  notes: { id: number; text: string; created_at: string }[];
  updates?: MemoryUpdate[];
};

/** Expenses that look like the same thing twice (e.g. two imports of the same chat). */
export type DuplicateGroup = {
  day: string;
  total_paise: number;
  items: {
    id: number;
    description: string;
    category_id: number | null;
    source: "log" | "manual" | "import";
    import_batch_id: number | null;
    occurred_at: string;
  }[];
};

// ── Savings goals ────────────────────────────────────────────────────────────

export type Goal = {
  id: number;
  name: string;
  target_paise: number;
  saved_paise: number;
  left_paise: number;
  progress: number;
  due_on: string | null;
  months_left: number | null;
  /** What a month it takes to reach the target by its date. */
  monthly_needed_paise: number | null;
  saved_this_month_paise: number;
  done: boolean;
  archived: boolean;
  created_at: string;
  deposits?: { id: number; amount_paise: number; note: string | null; created_at: string }[];
};
