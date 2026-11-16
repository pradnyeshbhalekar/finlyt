// What the + in Home's box opens: the other ways to add something, each one tap. Typing and
// talking stay in the box itself.
import { ChevronRight, MessageSquareText, PencilLine, ScanLine } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Icon, Sheet, Txt, type IconType } from "./ui";

function Option({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: IconType;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-16 flex-row items-center gap-4 rounded-2xl px-2 py-3 active:bg-surface"
    >
      <View className="h-11 w-11 items-center justify-center rounded-full bg-accent-soft">
        <Icon icon={icon} size={22} tone="accent" />
      </View>
      <View className="flex-1">
        <Txt weight="semibold" className="text-base">
          {title}
        </Txt>
        <Txt tone="muted" className="mt-0.5 text-sm">
          {detail}
        </Txt>
      </View>
      <Icon icon={ChevronRight} size={18} tone="faint" />
    </Pressable>
  );
}

export function AddSheet({
  visible,
  onClose,
  onForm,
  onScan,
  onPasteSms,
}: {
  visible: boolean;
  onClose: () => void;
  onForm: () => void;
  onScan: () => void;
  onPasteSms: () => void;
}) {
  // Close first, then act, so the sheet isn't left open behind the scanner or the form.
  const then = (action: () => void) => () => {
    onClose();
    setTimeout(action, 180);
  };
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Txt weight="semibold" className="mb-2 px-2 text-xl">
        Add an expense
      </Txt>
      <Option icon={ScanLine} title="Scan a receipt" detail="Finlyt reads the shop, the total and the date" onPress={then(onScan)} />
      <Option
        icon={MessageSquareText}
        title="Paste a bank SMS"
        detail="Copy it in Messages first. Read by rules, no AI"
        onPress={then(onPasteSms)}
      />
      <Option icon={PencilLine} title="Fill in a form" detail="Amount, what for, who owes you" onPress={then(onForm)} />
    </Sheet>
  );
}
