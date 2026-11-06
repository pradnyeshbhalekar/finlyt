// Charts for the month report, following the dataviz rules: one hue (the theme's `chart` blue,
// validated against each background), thin marks with a 2px gap, 4px rounded data ends square at
// the baseline, a hairline baseline and limit line (never dashed), text in text colours, and
// labels only where they help. Tap a day to read it; the biggest day is labelled until you do.
import { useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Path } from "react-native-svg";

import { formatPaise } from "@/lib/money";
import { useTheme } from "@/lib/theme";

import { Txt } from "./ui";

/** A column with rounded top corners and a square foot on the baseline. */
function column(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** Spending per day, with the usual-day limit as a hairline. */
export function DailyBars({
  days,
  limitPaise,
  height = 132,
}: {
  days: { day: string; spent_paise: number }[];
  limitPaise?: number | null;
  height?: number;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const n = days.length;
  const peak = days.reduce((best, d, i) => (d.spent_paise > (days[best]?.spent_paise ?? -1) ? i : best), 0);
  const top = Math.max(...days.map((d) => d.spent_paise), limitPaise ?? 0, 1) * 1.08;
  const slot = n ? width / n : 0;
  const barW = Math.max(Math.min(24, slot - 2), 1);
  const y = (paise: number) => height - (paise / top) * height;
  const shown = picked ?? peak;
  const focus = days[shown];

  return (
    <View>
      <View className="mb-2 flex-row items-baseline gap-2">
        <Txt weight="semibold" className="text-base">
          {focus ? formatPaise(focus.spent_paise) : "₹0"}
        </Txt>
        <Txt tone="muted" className="text-sm">
          {focus ? `${picked === null ? "biggest day, " : ""}${dayLabel(focus.day)}` : ""}
        </Txt>
      </View>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {days.map((d, i) =>
              d.spent_paise > 0 ? (
                <Path
                  key={d.day}
                  d={column(i * slot + (slot - barW) / 2, y(d.spent_paise), barW, height - y(d.spent_paise))}
                  fill={colors.chart}
                  opacity={picked === null || picked === i ? 1 : 0.35}
                />
              ) : null,
            )}
            <Line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={colors.line} strokeWidth={1} />
            {limitPaise ? (
              <Line x1={0} x2={width} y1={y(limitPaise)} y2={y(limitPaise)} stroke={colors.muted} strokeWidth={1} opacity={0.7} />
            ) : null}
          </Svg>
        ) : null}
        {/* Tap targets: each day's whole column, bigger than its bar. */}
        {width > 0 ? (
          <View className="absolute inset-0 flex-row">
            {days.map((d, i) => (
              <Pressable
                key={d.day}
                style={{ width: slot, height }}
                onPress={() => setPicked(picked === i ? null : i)}
                accessibilityLabel={`${dayLabel(d.day)}: ${formatPaise(d.spent_paise)}`}
              />
            ))}
          </View>
        ) : null}
      </View>
      <View className="mt-1.5 flex-row justify-between">
        <Txt tone="faint" className="text-xs">
          {days[0] ? Number(days[0].day.slice(8)) : ""}
        </Txt>
        {limitPaise ? (
          <Txt tone="faint" className="text-xs">
            line: {formatPaise(limitPaise)} usual-day limit
          </Txt>
        ) : null}
        <Txt tone="faint" className="text-xs">
          {days.at(-1) ? Number(days.at(-1)!.day.slice(8)) : ""}
        </Txt>
      </View>
    </View>
  );
}

/** Ranked bars, largest first, one hue, with an optional tick at each row's usual amount. */
export function RankedBars({
  rows,
  showUsual = true,
}: {
  rows: { key: string; label: string; paise: number; usualPaise?: number | null; detail?: string }[];
  showUsual?: boolean;
}) {
  const { colors } = useTheme();
  const scale = Math.max(...rows.map((r) => Math.max(r.paise, showUsual ? (r.usualPaise ?? 0) : 0)), 1);
  const anyUsual = showUsual && rows.some((r) => r.usualPaise);
  return (
    <View className="gap-3">
      {anyUsual ? (
        <View className="flex-row items-center gap-4">
          <View className="flex-row items-center gap-1.5">
            <View className="h-2 w-3 rounded-sm" style={{ backgroundColor: colors.chart }} />
            <Txt tone="muted" className="text-xs">
              This month
            </Txt>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="h-3 w-0.5" style={{ backgroundColor: colors.fg }} />
            <Txt tone="muted" className="text-xs">
              Your usual
            </Txt>
          </View>
        </View>
      ) : null}
      {rows.map((r) => (
        <View key={r.key}>
          <View className="flex-row items-baseline justify-between gap-3">
            <Txt weight="medium" className="flex-1 text-sm" numberOfLines={1}>
              {r.label}
            </Txt>
            <Txt weight="semibold" className="text-sm">
              {formatPaise(r.paise)}
            </Txt>
          </View>
          <View className="mt-1.5 h-3 justify-center">
            <View className="h-2 rounded-r" style={{ width: `${Math.max((r.paise / scale) * 100, r.paise > 0 ? 1 : 0)}%`, backgroundColor: colors.chart, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
            {showUsual && r.usualPaise ? (
              <View className="absolute h-3 w-0.5" style={{ left: `${Math.min((r.usualPaise / scale) * 100, 99.5)}%`, backgroundColor: colors.fg }} />
            ) : null}
          </View>
          {r.detail ? (
            <Txt tone="muted" className="mt-1 text-xs">
              {r.detail}
            </Txt>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** A ratio against a limit, same-hue track. */
export function Meter({ ratio }: { ratio: number }) {
  const { colors } = useTheme();
  return (
    <View className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: colors.accentSoft }}>
      <View className="h-2 rounded-full" style={{ width: `${Math.min(Math.max(ratio, 0), 1) * 100}%`, backgroundColor: colors.chart }} />
    </View>
  );
}
