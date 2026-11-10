import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File } from "expo-file-system";

import { api, queryString } from "./api";
import type {
  ActivityPage,
  DuplicateGroup,
  Goal,
  AskThread,
  AskThreadList,
  AskTurn,
  Balances,
  BankTxnItem,
  ChatMessage,
  Expense,
  ExpenseList,
  ImportBatch,
  ImportEntry,
  ImportPreview,
  ImportResult,
  ImportSource,
  MonthReport,
  MoneyMemory,
  LogCommit,
  LogCommitResult,
  Meta,
  NewExpense,
  PlanStatus,
  PlanTurn,
  Proposal,
  ProposedPlan,
  Stats,
} from "./types";

export function useMeta() {
  return useQuery({
    queryKey: ["meta"],
    queryFn: () => api<Meta>("/api/meta"),
    staleTime: 5 * 60_000,
  });
}

export function useStats(from: string, to: string) {
  return useQuery({
    queryKey: ["stats", from, to],
    queryFn: () => api<Stats>(`/api/stats${queryString({ from, to })}`),
  });
}

export function useExpenses(params: { from?: string; to?: string; limit?: number; category_id?: number } = {}) {
  return useQuery({
    queryKey: ["expenses", params],
    queryFn: () => api<ExpenseList>(`/api/expenses${queryString(params)}`),
  });
}

/** One entry, for its full-screen view. */
export function useExpense(id: number) {
  return useQuery({
    queryKey: ["expenses", "one", id],
    queryFn: () => api<Expense>(`/api/expenses/${id}`),
    enabled: Number.isFinite(id),
  });
}

/** Refetch everything money-related, e.g. after something was saved or settled. */
export function useRefreshMoney() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stats"] }),
      queryClient.invalidateQueries({ queryKey: ["expenses"] }),
      queryClient.invalidateQueries({ queryKey: ["meta"] }),
      queryClient.invalidateQueries({ queryKey: ["plan"] }),
      queryClient.invalidateQueries({ queryKey: ["txns"] }),
      queryClient.invalidateQueries({ queryKey: ["activity"] }),
      queryClient.invalidateQueries({ queryKey: ["balances"] }),
      queryClient.invalidateQueries({ queryKey: ["report"] }),
      queryClient.invalidateQueries({ queryKey: ["memory"] }),
      queryClient.invalidateQueries({ queryKey: ["duplicates"] }),
    ]);
}

/** Change an entry (only the fields sent change), e.g. move it to the day it happened. */
export function useUpdateExpense() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number; occurred_at?: string }) =>
      api<Expense>(`/api/expenses/${id}`, { method: "PATCH", body: patch }),
    onSuccess: refresh,
  });
}

export function useCreateExpense() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: (body: NewExpense) => api<Expense>("/api/expenses", { method: "POST", body }),
    onSuccess: refresh,
  });
}

export function useDeleteExpense() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/expenses/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
}

/** Send a voice note and/or text to Gemini. Returns an editable proposal; nothing is saved. */
export function useProposeLog() {
  return useMutation({
    mutationFn: ({ text, audioUri, txnIds }: { text: string; audioUri: string | null; txnIds?: number[] }) => {
      if (!audioUri) {
        return api<Proposal>("/api/log/propose", { method: "POST", body: { text, txn_ids: txnIds } });
      }
      const recording = new File(audioUri);
      const form = new FormData();
      form.append("text", text);
      if (txnIds) form.append("txn_ids", JSON.stringify(txnIds));
      // Expo's fetch (SDK 58) doesn't take React Native's { uri, name, type } parts. It takes
      // any object with name, type and bytes(), so read the recording through expo-file-system.
      const audio = {
        name: "note.aac",
        type: "audio/aac",
        bytes: async () => new Uint8Array(await recording.arrayBuffer()),
      };
      form.append("audio", audio as unknown as Blob);
      return api<Proposal>("/api/log/propose", { method: "POST", form });
    },
  });
}

export function useCommitLog() {
  const refresh = useRefreshMoney();
  return useMutation({
    mutationFn: (body: LogCommit) =>
      api<LogCommitResult>("/api/log/commit", { method: "POST", body }),
    onSuccess: refresh,
  });
}

/** Today's limit and what's left, the buffer, and this month's budget. */
export function usePlan() {
  return useQuery({
    queryKey: ["plan"],
    queryFn: () => api<PlanStatus>("/api/plan"),
    retry: false, // an older server without planning just hides it
  });
}

export function usePlanChat() {
  const queryClient = useQueryClient();
  return useMutation({
    // Only role and text go to the server (the screen keeps more on each message).
    mutationFn: (messages: ChatMessage[]) =>
      api<PlanTurn>("/api/plan/chat", {
        method: "POST",
        body: { messages: messages.map(({ role, text }) => ({ role, text })) },
      }),
    onSuccess: (turn) => {
      if (turn.memory_updates?.length) void queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
  });
}

export function useSavePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (plan: ProposedPlan) =>
      api<PlanStatus>("/api/plan", {
        method: "POST",
        body: {
          monthly_budget_paise: plan.monthly_budget_paise,
          daily_limit_paise: plan.daily_limit_paise,
          big_day_limit_paise: plan.big_days_per_week > 0 ? plan.big_day_limit_paise : null,
          big_days_per_week: plan.big_day_limit_paise ? plan.big_days_per_week : 0,
          planned_items: plan.planned_items.map((i) => ({
            description: i.description,
            amount_paise: i.amount_paise,
            due_on: i.due_on,
            category_id: i.category_id,
          })),
          notes: plan.notes,
        },
      }),
    onSuccess: (status) => queryClient.setQueryData(["plan"], status),
  });
}

/** Bank payments waiting to be explained (last 14 days). */
export function usePendingTxns() {
  return useQuery({
    queryKey: ["txns"],
    queryFn: () => api<{ items: BankTxnItem[] }>("/api/txns"),
    retry: false, // older servers don't have it
  });
}

export function useResolveTxn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: "transfer" | "ignored" | "income" }) =>
      api<BankTxnItem>(`/api/txns/${id}/resolve`, { method: "POST", body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["txns"] }),
  });
}

/** History: every kind of event, newest first, a page at a time. */
export function useActivity() {
  return useInfiniteQuery({
    queryKey: ["activity"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<ActivityPage>(`/api/activity${queryString({ limit: 60, before: pageParam ?? undefined })}`),
    getNextPageParam: (last) => last.next_before,
  });
}

/** Who owes me, and whom I owe. */
export function useBalances() {
  return useQuery({ queryKey: ["balances"], queryFn: () => api<Balances>("/api/people/balances") });
}

/** Ask a question in a saved chat, or start one (`threadId` null). The server keeps the history. */
export function useAsk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ text, threadId }: { text: string; threadId: number | null }) =>
      api<AskTurn>("/api/ask", { method: "POST", body: { text, thread_id: threadId ?? undefined } }),
    onSuccess: (turn) => {
      void queryClient.invalidateQueries({ queryKey: ["ask-threads"] });
      if (turn.memory_updates?.length) {
        void queryClient.invalidateQueries({ queryKey: ["memory"] });
        void queryClient.invalidateQueries({ queryKey: ["plan"] });
      }
    },
  });
}

/** Past Ask chats, newest first. The server deletes ones untouched for `keep_days`. */
export function useAskThreads(enabled: boolean) {
  return useQuery({
    queryKey: ["ask-threads"],
    queryFn: () => api<AskThreadList>("/api/ask/threads"),
    enabled,
    retry: false,
  });
}

export function fetchAskThread(id: number) {
  return api<AskThread>(`/api/ask/threads/${id}`);
}

export function useDeleteAskThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/ask/threads/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ask-threads"] }),
  });
}

/** A separate sign-in token for an AI assistant (MCP client) such as Claude. */

// ── Import from an AI chat ───────────────────────────────────────────────────

export function fetchImportPrompt() {
  return api<{ prompt: string }>("/api/import/prompt");
}

export function useImportPreview() {
  return useMutation({
    mutationFn: ({ text, source }: { text: string; source: ImportSource }) =>
      api<ImportPreview>("/api/import/preview", { method: "POST", body: { text, source } }),
  });
}

const ENTRY_FIELDS = [
  "kind",
  "occurred_at",
  "description",
  "category_id",
  "amount_paise",
  "my_share_paise",
  "payments",
  "dues",
  "person_name",
  "note_raw",
] as const;

export function useImportCommit() {
  const refresh = useRefreshMoney();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entries, source, rawText }: { entries: ImportEntry[]; source: ImportSource; rawText: string }) =>
      api<ImportResult>("/api/import/commit", {
        method: "POST",
        body: {
          source,
          raw_text: rawText,
          entries: entries.map((e) => Object.fromEntries(ENTRY_FIELDS.map((k) => [k, e[k]]))),
        },
      }),
    onSuccess: () => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ["imports"] });
    },
  });
}

export function useImportBatches() {
  return useQuery({
    queryKey: ["imports"],
    queryFn: () => api<{ items: ImportBatch[] }>("/api/import/batches"),
    retry: false, // older servers don't have imports
  });
}

export function useUndoImport() {
  const refresh = useRefreshMoney();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/import/batches/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ["imports"] });
    },
  });
}

// ── Month reports and what Finlyt remembers ──────────────────────────────────

/** `month` is YYYY-MM; omit it for this month. */
export function useMonthReport(month?: string) {
  return useQuery({
    queryKey: ["report", month ?? "current"],
    queryFn: () => api<MonthReport>(`/api/reports/month${queryString({ month })}`),
    retry: false,
  });
}

export function useMemory() {
  return useQuery({ queryKey: ["memory"], queryFn: () => api<MoneyMemory>("/api/memory"), retry: false });
}

function useMemoryChange<T>(request: (arg: T) => Promise<MoneyMemory>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (data) => {
      queryClient.setQueryData(["memory"], data);
      void queryClient.invalidateQueries({ queryKey: ["plan"] });
    },
  });
}

export function useSetIncome() {
  return useMemoryChange((monthly_income_paise: number | null) =>
    monthly_income_paise
      ? api<MoneyMemory>("/api/memory/income", { method: "PUT", body: { monthly_income_paise } })
      : api<MoneyMemory>("/api/memory/income", { method: "DELETE" }),
  );
}

export function useChangeCommitment() {
  return useMemoryChange(({ id, ...patch }: { id: number; monthly_paise?: number; active?: boolean }) =>
    api<MoneyMemory>(`/api/memory/commitments/${id}`, { method: "PATCH", body: patch }),
  );
}

export function useDeleteCommitment() {
  return useMemoryChange((id: number) => api<MoneyMemory>(`/api/memory/commitments/${id}`, { method: "DELETE" }));
}

export function useDeleteNote() {
  return useMemoryChange((id: number) => api<MoneyMemory>(`/api/memory/notes/${id}`, { method: "DELETE" }));
}

/** Expenses that look like the same thing twice. */
export function useDuplicates() {
  return useQuery({
    queryKey: ["duplicates"],
    queryFn: () => api<{ groups: DuplicateGroup[] }>("/api/expenses/duplicates"),
    retry: false,
  });
}

// ── Savings goals ────────────────────────────────────────────────────────────

export function useGoals() {
  return useQuery({ queryKey: ["goals"], queryFn: () => api<{ items: Goal[] }>("/api/goals"), retry: false });
}

export function useGoal(id: number) {
  return useQuery({ queryKey: ["goals", id], queryFn: () => api<Goal>(`/api/goals/${id}`), enabled: Number.isFinite(id) });
}

function useGoalChange<T>(request: (arg: T) => Promise<Goal | void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
      void queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
  });
}

export function useCreateGoal() {
  return useGoalChange((body: { name: string; target_paise: number; due_on: string | null }) =>
    api<Goal>("/api/goals", { method: "POST", body }),
  );
}

export function useUpdateGoal() {
  return useGoalChange(({ id, ...patch }: { id: number; name?: string; target_paise?: number; due_on?: string | null }) =>
    api<Goal>(`/api/goals/${id}`, { method: "PATCH", body: patch }),
  );
}

export function useDeleteGoal() {
  return useGoalChange((id: number) => api<void>(`/api/goals/${id}`, { method: "DELETE" }));
}

export function useGoalDeposit() {
  return useGoalChange(({ id, amount_paise, note }: { id: number; amount_paise: number; note?: string }) =>
    api<Goal>(`/api/goals/${id}/deposits`, { method: "POST", body: { amount_paise, note } }),
  );
}
