import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File } from "expo-file-system";

import { api, queryString } from "./api";
import type {
  Expense,
  ExpenseList,
  LogCommit,
  LogCommitResult,
  Meta,
  NewExpense,
  Proposal,
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

function useRefreshMoney() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stats"] }),
      queryClient.invalidateQueries({ queryKey: ["expenses"] }),
      queryClient.invalidateQueries({ queryKey: ["meta"] }),
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
    mutationFn: ({ text, audioUri }: { text: string; audioUri: string | null }) => {
      if (!audioUri) return api<Proposal>("/api/log/propose", { method: "POST", body: { text } });
      const recording = new File(audioUri);
      const form = new FormData();
      form.append("text", text);
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
