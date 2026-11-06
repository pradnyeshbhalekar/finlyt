import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File } from "expo-file-system";

import { api, queryString } from "./api";
import type {
  ActivityPage,
  AskThread,
  AskThreadList,
  AskTurn,
  Balances,
  BankTxnItem,
  ChatMessage,
  Expense,
  ExpenseList,
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

export function useExpenses(params: { from?: string; to?: string; limit?: number } = {}) {
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

/** Refetch everything money-related, e.g. after an SMS sync saved or settled something. */
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
    ]);
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
  return useMutation({
    mutationFn: (messages: ChatMessage[]) =>
      api<PlanTurn>("/api/plan/chat", { method: "POST", body: { messages } }),
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

/** Bank payments from SMS waiting to be explained (last 14 days). */
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ask-threads"] }),
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
export function useConnectToken() {
  return useMutation({
    mutationFn: () => api<{ token: string; mcp_url: string }>("/api/auth/connect-token", { method: "POST" }),
  });
}
