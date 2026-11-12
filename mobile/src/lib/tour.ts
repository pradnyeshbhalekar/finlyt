// The tour. It opens with an overview of everything Finlyt does on one screen, then walks
// through the real app (Home, Ask, Plan, History, Settings), lighting up one part at a time with
// a short note in plain words. Screens mark those parts with <TourTarget>, which reports where
// they are; <TourHost> in the root layout draws the overview, the spotlight and the notes.
// Kept outside React so any screen can start it.
import {
  CalendarDays,
  HandCoins,
  History,
  Keyboard,
  ListChecks,
  Mic,
  PartyPopper,
  Plus,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react-native";
import { useSyncExternalStore } from "react";

import { AskIcon } from "@/components/ask-icon";

/** Bump when the tour changes enough that everyone should see it once more (after an update). */
export const TOUR_VERSION = 2;

export type Rect = { x: number; y: number; width: number; height: number };

type IconLike = LucideIcon | typeof AskIcon;

export type TourStep = {
  /** "overview": everything on one screen; "spot": light up a part; "end": the last note. */
  kind: "overview" | "spot" | "end";
  /** The <TourTarget id> to light up (for "spot"). */
  target: string | null;
  icon: IconLike;
  /** The tab it's on. */
  route: "/" | "/ask" | "/plan" | "/history";
  title: string;
  text: string;
  /** Corner radius of the lit-up area. */
  radius?: number;
};

export type TourOptions = {
  /** "onboarding": the first time, right after the welcome. "settings": opened again later.
   *  "update": shown once to people who already use Finlyt, after an update with a new tour. */
  from: "onboarding" | "settings" | "update";
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

/** The stops, in order. Words are kept short and plain, for someone who has never used it. */
export function tourSteps(reviewBeforeSave: boolean): TourStep[] {
  return [
    { kind: "overview", target: null, route: "/", icon: ListChecks, title: "Everything in one minute", text: "" },
    {
      kind: "spot",
      target: "composer",
      route: "/",
      icon: Keyboard,
      title: "Type what you spent",
      text: reviewBeforeSave
        ? "Tap this box and type it the way you'd tell a friend, like “chai 40” or “auto 120 cash”. Tap the blue arrow, check what Finlyt understood, then tap Save."
        : "Tap this box and type it the way you'd tell a friend, like “chai 40” or “auto 120 cash”. Tap the blue arrow and it's saved, with an Undo.",
      radius: 32,
    },
    {
      kind: "spot",
      target: "mic",
      route: "/",
      icon: Mic,
      title: "Or just say it",
      text: "Tap the mic and talk. Your words appear in the box. Check them, then tap the blue arrow.",
    },
    {
      kind: "spot",
      target: "add-by-hand",
      route: "/",
      icon: Plus,
      title: "Or fill in a form",
      text: "Tap + to type the amount, what it was for and how you paid, one box at a time.",
    },
    {
      kind: "spot",
      target: "today",
      route: "/",
      icon: CalendarDays,
      title: "Your day at a glance",
      text: "The big number is what you've spent today. Once you plan your month, the bar shows what's left of today's limit.",
      radius: 20,
    },
    {
      kind: "spot",
      target: "tiles",
      route: "/",
      icon: HandCoins,
      title: "This month, and money owed",
      text: "What you've spent this month, and what friends owe you. Paid for a friend? Say “lunch 450 with Rahul, he owes 200”.",
      radius: 28,
    },
    {
      kind: "spot",
      target: "logged",
      route: "/",
      icon: ListChecks,
      title: "Today's entries",
      text: "Everything you log today shows up here. Tap one to see it, or press and hold to delete it.",
      radius: 16,
    },
    {
      kind: "spot",
      target: "ask-box",
      route: "/ask",
      icon: AskIcon,
      title: "Ask about your money",
      text: "Ask anything, like “Where did my money go this month?” or “Kal kitna kharcha hua?”. Tell it your salary or rent, and it remembers.",
      radius: 32,
    },
    {
      kind: "spot",
      target: "plan-main",
      route: "/plan",
      icon: Target,
      title: "Plan your month",
      text: "A short chat sets your budget and a daily limit. What you don't spend is saved for surprises. Savings goals live here too.",
      radius: 28,
    },
    {
      kind: "spot",
      target: "tab-history",
      route: "/history",
      icon: History,
      title: "History",
      text: "Every entry, payback and plan change, day by day.",
      radius: 20,
    },
    {
      kind: "spot",
      target: "avatar",
      route: "/",
      icon: Settings,
      title: "Settings",
      text: "Tap your photo for Settings: the theme, reminder times, import from an AI chat, widgets, and this tour again.",
    },
    {
      kind: "end",
      target: null,
      route: "/",
      icon: PartyPopper,
      title: "You're all set",
      text: "Try your first one now: type “chai 40” in the box and tap the blue arrow.",
    },
  ];
}
