// The check-in chat, kept outside the screen so it survives leaving it: go back mid-conversation
// (or while Finlyt is still thinking) and it's all there when you return, and a reply that
// arrives while you're elsewhere can notify you (lib/reply-alert). It starts over once a plan
// has been saved, after a few hours, when someone else signs in, or with "Start over".
import { useSyncExternalStore } from "react";

import { api, ApiError } from "./api";
import { alertIfAway } from "./reply-alert";
import type { ChatMessage, MemoryUpdate, PlanTurn, ProposedPlan } from "./types";

export type PlanMessage = ChatMessage & { memory?: MemoryUpdate[] };

type State = {
  messages: PlanMessage[];
  /** Finlyt's latest plan, if it has proposed one; `planRound` changes with each new one. */
  plan: ProposedPlan | null;
  planRound: number;
  /** Answers to tap for Finlyt's last question. */
  options: string[];
  pending: boolean;
  error: string | null;
  /** The plan was saved: the chat is finished. */
  saved: boolean;
};

const EMPTY: State = { messages: [], plan: null, planRound: 0, options: [], pending: false, error: null, saved: false };
/** An unfinished chat older than this starts over: the week it was about has moved on. */
const KEEP_MS = 6 * 60 * 60 * 1000;
const URL = "/plan/chat";

let state: State = EMPTY;
let ownerId: number | null = null;
let touchedAt = 0;
/** Bumped on every reset, so an answer to a chat that was thrown away is dropped. */
let generation = 0;
/** Set by the screen while it's open: is it the screen being looked at? */
let watcher: (() => boolean) | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  touchedAt = Date.now();
  listeners.forEach((listener) => listener());
}

function explain(e: unknown): string {
  if (e instanceof ApiError && e.status === 404) {
    return "Planning isn't switched on for your Finlyt server yet. It needs one more backend deploy.";
  }
  return (e as Error).message;
}

async function request(history: PlanMessage[]) {
  const mine = generation;
  set({ messages: history, pending: true, error: null, options: [] });
  try {
    const turn = await api<PlanTurn>("/api/plan/chat", {
      method: "POST",
      // Only role and text go to the server (the chat keeps more on each message).
      body: { messages: history.map(({ role, text }) => ({ role, text })) },
    });
    if (mine !== generation) return;
    set({
      messages: [...history, { role: "finlyt", text: turn.reply, memory: turn.memory_updates }],
      plan: turn.plan,
      planRound: turn.plan ? state.planRound + 1 : state.planRound,
      options: turn.options ?? [],
      pending: false,
    });
    const title = turn.plan ? "Your plan is ready" : history.length ? "Finlyt replied" : "Your check-in is ready";
    alertIfAway(watcher?.() ?? false, title, turn.reply, URL);
  } catch (e) {
    if (mine !== generation) return;
    set({ pending: false, error: explain(e) });
    alertIfAway(watcher?.() ?? false, "Finlyt couldn't reply", explain(e), URL);
  }
}

export const planChat = {
  /**
   * Called when the screen opens. Keeps an unfinished chat (or one still waiting for Finlyt);
   * otherwise starts a new one, which Finlyt opens.
   */
  enter(userId: number | null) {
    const stale = state.saved || userId !== ownerId || (!state.pending && Date.now() - touchedAt > KEEP_MS);
    ownerId = userId;
    if (stale) planChat.startOver();
    else if (state.messages.length === 0 && !state.pending) void request([]);
  },
  startOver() {
    generation += 1;
    state = EMPTY;
    void request([]);
  },
  /** After an error on Finlyt's opening line. */
  retry() {
    if (!state.pending) void request(state.messages);
  },
  send(text: string) {
    const words = text.trim();
    if (!words || state.pending) return;
    void request([...state.messages, { role: "user", text: words }]);
  },
  /** The plan was saved: say so, and finish the chat. */
  finish(text: string) {
    set({ messages: [...state.messages, { role: "finlyt", text }], saved: true, options: [] });
  },
  watch(isWatching: (() => boolean) | null) {
    watcher = isWatching;
  },
  get(): State {
    return state;
  },
};

export function usePlanChatState(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
