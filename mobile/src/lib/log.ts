// Turning Gemini's proposal into what /api/log/commit saves.
import { formatPaise } from "./money";
import type { LogCommit, Proposal, SmsMatch } from "./types";

export function proposalToCommit(p: Proposal, noteRaw: string | null): LogCommit {
  return {
    expenses: p.expenses.map((e) => ({
      occurred_at: e.occurred_at,
      description: e.description,
      category_id: e.category_id,
      payments: e.payments.map((x) => ({
        account_id: x.account_id,
        amount_paise: x.amount_paise,
        bank_txn_id: x.bank_txn_id,
      })),
      dues: e.dues,
      note_raw: noteRaw,
    })),
    settlements: p.settlements.map((s) => ({
      person_name: s.person_name,
      amount_paise: s.amount_paise,
      bank_txn_id: s.bank_txn_id,
    })),
    transfers: p.transfers.map((t) => t.bank_txn_id),
    ignored: p.ignored.map((t) => t.bank_txn_id),
    debts: (p.debts ?? []).map((d) => ({
      person_name: d.person_name,
      amount_paise: d.amount_paise,
      description: d.description,
      category_id: d.category_id,
      note_raw: noteRaw,
    })),
    repayments: (p.repayments ?? []).map((r) => ({
      person_name: r.person_name,
      amount_paise: r.amount_paise,
      bank_txn_id: r.bank_txn_id,
    })),
  };
}

export function entryCount(p: Proposal): number {
  return (
    p.expenses.length +
    p.settlements.length +
    p.transfers.length +
    p.ignored.length +
    (p.debts?.length ?? 0) +
    (p.repayments?.length ?? 0)
  );
}

/** Anything Gemini flagged as not adding up. Such proposals always get a check. */
export function hasIssues(p: Proposal): boolean {
  return (
    p.expenses.some((e) => e.issues.length > 0) ||
    p.settlements.some((s) => s.issues.length > 0) ||
    (p.repayments ?? []).some((r) => r.issues.length > 0)
  );
}

export function savedMessage(body: LogCommit): string {
  const parts: string[] = [];
  const n = body.expenses.length;
  if (n) parts.push(`${n} ${n === 1 ? "entry" : "entries"}`);
  const s = body.settlements.length;
  if (s) parts.push(`${s} payback${s === 1 ? "" : "s"}`);
  const d = body.debts?.length ?? 0;
  if (d) parts.push(`${d} ${d === 1 ? "thing" : "things"} you owe`);
  const r = body.repayments?.length ?? 0;
  if (r) parts.push(`${r} paid back`);
  return parts.length ? `Saved ${parts.join(" and ")}` : "Saved";
}

/** Undo deletes the saved entries, so only saves made of plain entries can be undone. */
export function isUndoable(body: LogCommit): boolean {
  return (
    body.settlements.length +
      body.transfers.length +
      body.ignored.length +
      (body.debts?.length ?? 0) +
      (body.repayments?.length ?? 0) ===
    0
  );
}

const QUESTION_START =
  /^(how|what|where|when|who|whom|which|why|show|list|tell|did|do|does|am|is|are|kitna|kitne|kitni|kab|kahan|kaha|kaun|kis|kya)\b/i;

/** "where did my money go?" goes to Ask; "chai 40 cash" gets logged. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return t.endsWith("?") || (QUESTION_START.test(t) && !/\d/.test(t.split(/\s+/)[0] ?? ""));
}

export function matchedMessage(matches: SmsMatch[]): string {
  const parts = matches.map((m) =>
    m.kind === "repaid"
      ? `paid back ${m.person} ${formatPaise(m.amount_paise)}`
      : `${m.person} paid you back ${formatPaise(m.amount_paise)}`,
  );
  return `From your bank SMS: ${parts.join(", ")}`;
}
