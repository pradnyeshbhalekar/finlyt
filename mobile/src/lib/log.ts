// Turning Gemini's proposal into what /api/log/commit saves.
import type { LogCommit, Proposal } from "./types";

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
  };
}

export function entryCount(p: Proposal): number {
  return p.expenses.length + p.settlements.length + p.transfers.length + p.ignored.length;
}

/** Anything Gemini flagged as not adding up. Such proposals always get a check. */
export function hasIssues(p: Proposal): boolean {
  return p.expenses.some((e) => e.issues.length > 0) || p.settlements.some((s) => s.issues.length > 0);
}

export function savedMessage(body: LogCommit): string {
  const parts: string[] = [];
  const n = body.expenses.length;
  if (n) parts.push(`${n} ${n === 1 ? "entry" : "entries"}`);
  const s = body.settlements.length;
  if (s) parts.push(`${s} payback${s === 1 ? "" : "s"}`);
  return parts.length ? `Saved ${parts.join(" and ")}` : "Saved";
}
