// During onboarding, the Import screen is only reachable after "Import from a chat" is tapped.
// If it were always reachable before onboarding is done, Expo Router would open it on launch
// (it lands on the first reachable screen), and new users would never see onboarding.
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function set(value: boolean) {
  open = value;
  listeners.forEach((l) => l());
}

export const importGate = {
  open: () => set(true),
  close: () => set(false),
};

export function useImportGate(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
}
