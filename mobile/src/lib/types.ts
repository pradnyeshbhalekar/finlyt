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

export type SmsFilter = {
  account_id: number;
  bank_code: string;
  sender_patterns: string[];
  body_markers: string[];
};

export type Meta = {
  user: User;
  timezone: string;
  server_time: string;
  accounts: Account[];
  categories: Category[];
  people: Person[];
  sms_filters: SmsFilter[];
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
