// "Remembered: …" under a Finlyt answer, like Claude's memory note. Tap to see everything Finlyt
// remembers (and change it).
import { router } from "expo-router";
import { BookmarkCheck } from "lucide-react-native";
import { Pressable } from "react-native";

import type { MemoryUpdate } from "@/lib/types";

import { Icon, Txt } from "./ui";

export function MemoryUpdates({ updates, inset = true }: { updates?: MemoryUpdate[]; inset?: boolean }) {
  if (!updates?.length) return null;
  return (
    <Pressable
      onPress={() => router.push("/memory")}
      accessibilityRole="button"
      accessibilityHint="Opens what Finlyt remembers"
      className={`mb-3 flex-row gap-2 self-start rounded-2xl bg-surface px-3 py-2 active:opacity-70 ${inset ? "ml-9" : ""}`}
    >
      <Icon icon={BookmarkCheck} size={16} tone="accent" />
      <Txt tone="muted" className="flex-shrink text-xs leading-5">
        {updates.map((u) => u.text).join("\n")}
      </Txt>
    </Pressable>
  );
}
