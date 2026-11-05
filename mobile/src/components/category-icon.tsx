// Lucide icons for categories, matched by name (the emoji stored on the server isn't shown).
import {
  Car,
  Clapperboard,
  Dumbbell,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Plane,
  Receipt,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Tag,
  TrendingUp,
  Utensils,
  type LucideIcon,
} from "lucide-react-native";
import { View } from "react-native";

import { Icon } from "./ui";

const BY_NAME: Record<string, LucideIcon> = {
  food: Utensils,
  groceries: ShoppingBasket,
  transport: Car,
  shopping: ShoppingBag,
  bills: Receipt,
  rent: House,
  fitness: Dumbbell,
  entertainment: Clapperboard,
  health: HeartPulse,
  "personal care": Sparkles,
  education: GraduationCap,
  travel: Plane,
  gifts: Gift,
  investments: TrendingUp,
};

export function categoryIcon(name: string | undefined | null): LucideIcon {
  return (name && BY_NAME[name.trim().toLowerCase()]) || Tag;
}

/** The category's icon in a soft circle, for list rows. */
export function CategoryBadge({ name, size = 40 }: { name: string | undefined | null; size?: number }) {
  return (
    <View
      className="items-center justify-center rounded-full bg-surface"
      style={{ width: size, height: size }}
    >
      <Icon icon={categoryIcon(name)} size={size * 0.45} tone="muted" />
    </View>
  );
}
