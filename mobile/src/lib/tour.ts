// The guided tour: it walks through the real app (Home, Ask, Plan, History, Settings), lighting up
// one part of a screen at a time with a short note. Screens mark those parts with <TourTarget>,
// which reports where they are; <TourHost> in the root layout draws the spotlight and the note.
// Kept outside React so any screen can start it.
import { useSyncExternalStore } from "react";

export type Rect = { x: number; y: number; width: number; height: number };

export type TourStep = {
  /** The <TourTarget id> to light up, or null for a note in the middle of the screen. */
  target: string | null;
  /** The tab it's on. */
  route: "/" | "/ask" | "/plan" | "/history";
  title: string;
  text: string;
  /** Corner radius of the lit-up area. */
  radius?: number;
};

export type TourOptions = {
  /** "onboarding": the first time, right after the welcome. "settings": opened again later. */
  from: "onboarding" | "settings";
  /** Go on to the planning chat afterwards (they picked "Plan with Finlyt" in the welcome). */
  thenPlan?: boolean;
};

type State = {
  active: boolean;
  step: number;
  options: TourOptions;
  /** Where each target is, and the step round it was measured in (only fresh ones are used). */
  rects: Record<string, Rect & { round: number }>;
  /** Bumped when a step starts, so its target measures itself again. */
  round: number;
};

let state: State = { active: false, step: 0, options: { from: "settings" }, rects: {}, round: 0 };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export const tour = {
  start(options: TourOptions) {
    set({ active: true, step: 0, options, round: state.round + 1 });
  },
  go(step: number) {
    set({ step, round: state.round + 1 });
  },
  stop() {
    set({ active: false, step: 0 });
  },
  setRect(id: string, rect: Rect) {
    if (!state.active) return;
    const old = state.rects[id];
    const same =
      old && old.round === state.round && old.x === rect.x && old.y === rect.y && old.width === rect.width && old.height === rect.height;
    if (same) return;
    set({ rects: { ...state.rects, [id]: { ...rect, round: state.round } } });
  },
  get(): State {
    return state;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useTour(): State {
  return useSyncExternalStore(tour.subscribe, tour.get, tour.get);
}

/** The stops, in order. Words are kept short and plain. */
export function tourSteps(reviewBeforeSave: boolean): TourStep[] {
  return [
    {
      target: null,
      route: "/",
      title: "Let me show you around",
      text: "A quick look at the real app, one part at a time. It takes about a minute, and you can skip it.",
    },
    {
      target: "today",
      route: "/",
      title: "Your day at a glance",
      text: "The big number is what you've spent today. Once you plan your month, the bar shows how much of today's limit is left.",
      radius: 20,
    },
    {
      target: "tiles",
      route: "/",
      title: "This month, and money owed",
      text: "What you've spent this month, and what friends owe you. Tap either one for the details.",
      radius: 28,
    },
    {
      target: "composer",
      route: "/",
      title: "Log here, in plain words",
      text: reviewBeforeSave
        ? "Type what you spent the way you'd say it, like “chai 40 cash, auto 120”, or tap the mic and say it. Finlyt shows what it understood, and you tap Save."
        : "Type what you spent the way you'd say it, like “chai 40 cash, auto 120”, or tap the mic and say it. It's saved straight away, with an Undo.",
      radius: 32,
    },
    {
      target: "logged",
      route: "/",
      title: "Everything you logged today",
      text: "Your entries land here. Tap one to see it, or press and hold to delete it. Paid for a friend? Say “lunch 450 with Rahul, he owes 200”.",
      radius: 16,
    },
    {
      target: "ask-box",
      route: "/ask",
      title: "Ask about your money",
      text: "Ask anything, like “Where did my money go this month?” or “Kal kitna kharcha hua?”. Tell it your salary or rent, and it remembers.",
      radius: 32,
    },
    {
      target: "plan-main",
      route: "/plan",
      title: "Plan your month",
      text: "A short chat sets your budget and a daily limit. What you don't spend is saved for surprises. Every week Finlyt checks in, and savings goals live here too.",
      radius: 28,
    },
    {
      target: "tab-history",
      route: "/history",
      title: "History",
      text: "Every entry, payback and plan change, day by day.",
      radius: 20,
    },
    {
      target: "avatar",
      route: "/",
      title: "Settings",
      text: "Tap your photo for Settings: the theme, reminders, check before saving, add by hand, import from an AI chat, widgets, and this tour again.",
    },
    {
      target: null,
      route: "/",
      title: "You're all set",
      text: "Try your first one now. Something small, like “chai 40”.",
    },
  ];
}
