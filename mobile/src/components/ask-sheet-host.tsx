// Shows the sheet asked for with `askSheet` / `confirmDelete`: a title, a short message, the
// actions as full-width buttons (red for deleting), and Cancel. Mounted once at the root.
import { Trash2 } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { closeSheet, useAskSheet } from "@/lib/ask-sheet";
import { useTheme, WHITE } from "@/lib/theme";

import { Icon, Sheet, Txt } from "./ui";

export function AskSheetHost() {
  const request = useAskSheet();
  const { colors } = useTheme();
  const danger = request?.actions.some((a) => a.danger);
  return (
    <Sheet visible={request !== null} onClose={closeSheet}>
      {request ? (
        <View>
          {danger ? (
            <View className="mb-4 h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: colors.surface }}>
              <Icon icon={Trash2} size={22} tone="danger" />
            </View>
          ) : null}
          <Txt weight="semibold" className="text-xl">
            {request.title}
          </Txt>
          {request.message ? (
            <Txt tone="muted" className="mt-1.5 text-base leading-6">
              {request.message}
            </Txt>
          ) : null}
          <View className="mt-6 gap-2.5">
            {request.actions.map((a) => (
              <Pressable
                key={a.label}
                onPress={() => {
                  closeSheet();
                  a.onPress();
                }}
                accessibilityRole="button"
                className="h-12 items-center justify-center rounded-full active:opacity-80"
                style={{ backgroundColor: a.danger ? colors.danger : colors.surface }}
              >
                <Txt weight="semibold" style={{ color: a.danger ? WHITE : colors.fg }}>
                  {a.label}
                </Txt>
              </Pressable>
            ))}
            <Pressable onPress={closeSheet} accessibilityRole="button" className="h-12 items-center justify-center rounded-full active:opacity-60">
              <Txt weight="medium" tone="muted">
                {request.cancelLabel ?? "Cancel"}
              </Txt>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}
