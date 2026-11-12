// On-device preferences: theme, whether Gemini's entries need a review, and onboarding.
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { ThemeMode } from "./theme";

const KEY = "finlyt.prefs";

export type Prefs = {
  theme: ThemeMode;
  /** true: show Gemini's entries for a quick check before saving. false: save straight away. */
  reviewBeforeSave: boolean;
  onboarded: boolean;
  /** The tour version last shown (lib/tour TOUR_VERSION); a newer one is shown once. */
  tourVersion: number;
};

const DEFAULTS: Prefs = { theme: "auto", reviewBeforeSave: true, onboarded: false, tourVersion: 0 };

type PrefsState = Prefs & { loaded: boolean; update: (change: Partial<Prefs>) => void };

const PrefsContext = createContext<PrefsState>({ ...DEFAULTS, loaded: false, update: () => {} });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void SecureStore.getItemAsync(KEY)
      .then((saved) => {
        if (saved) setPrefs({ ...DEFAULTS, ...(JSON.parse(saved) as Partial<Prefs>) });
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  function update(change: Partial<Prefs>) {
    setPrefs((current) => {
      const next = { ...current, ...change };
      void SecureStore.setItemAsync(KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <PrefsContext.Provider value={{ ...prefs, loaded, update }}>{children}</PrefsContext.Provider>
  );
}

export function usePrefs(): PrefsState {
  return useContext(PrefsContext);
}
