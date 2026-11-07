// Our own confirm / choose sheet, instead of Android's system dialogs. Call `askSheet` from
// anywhere; the one <AskSheetHost /> at the root shows it.
import { useSyncExternalStore } from "react";

export type SheetAction = { label: string; danger?: boolean; onPress: () => void };
export type SheetRequest = { title: string; message?: string; actions: SheetAction[]; cancelLabel?: string };

let current: SheetRequest | null = null;
const listeners = new Set<() => void>();

function set(next: SheetRequest | null) {
  current = next;
  listeners.forEach((l) => l());
}

export function askSheet(request: SheetRequest) {
  set(request);
}

/** The usual "Delete this?" with one red button. */
export function confirmDelete(title: string, message: string | undefined, onConfirm: () => void, label = "Delete") {
  set({ title, message, actions: [{ label, danger: true, onPress: onConfirm }] });
}

export function closeSheet() {
  set(null);
}

export function useAskSheet(): SheetRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
