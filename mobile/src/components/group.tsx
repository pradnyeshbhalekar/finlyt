// Grouped rows in a rounded card, with hairlines between them and a chevron on the ones you can
// tap (Settings, Plan). Calm, and obviously tappable.
import { ChevronRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Icon, Txt, type IconType } from "./ui";

export function GroupLabel({ children, className = "mt-8" }: { children: ReactNode; className?: string }) {
  return (
    <Txt weight="medium" tone="muted" className={`mb-2 ml-1 text-xs uppercase ${className}`} style={{ letterSpacing: 0.6 }}>
      {children}
    </Txt>
  );
}

export function Group({ children }: { children: ReactNode }) {
  return <View className="overflow-hidden rounded-3xl bg-surface">{children}</View>;
}

export function GroupItem({
  icon,
  leading,
  title,
  subtitle,
  onPress,
  trailing,
  first = false,
  danger = false,
}: {
  icon?: IconType;
  /** Instead of an icon, e.g. a category badge. */
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  first?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      className={`min-h-14 flex-row items-center gap-3 px-4 py-3 active:opacity-60 ${first ? "" : "border-t border-line"}`}
    >
      {leading ?? (icon ? <Icon icon={icon} size={20} tone={danger ? "danger" : "muted"} /> : null)}
      <View className="flex-1">
        <Txt weight="medium" tone={danger ? "danger" : "fg"} className="text-base" numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt tone="muted" className="mt-0.5 text-sm" numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {trailing}
      {onPress ? <Icon icon={ChevronRight} size={16} tone="faint" /> : null}
    </Pressable>
  );
}
