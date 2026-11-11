// The home-screen widgets: Today (spent against the daily limit), Next check-in (and what's left to
// log), Log an expense (opens straight into typing or talking), and Last 7 days.
// These aren't React Native views: react-native-android-widget turns them into Android RemoteViews,
// so only its Flex/Text/Svg widgets and a subset of styles work. SVG is drawn to a bitmap.
// The React Compiler would add hooks (a memo cache) to these components, and widgets can't run hooks.
"use no memo";

import { FlexWidget, SvgWidget, TextWidget, type WidgetRepresentation } from "react-native-android-widget";

import { formatPaise } from "@/lib/money";
import type { ReminderTime } from "@/lib/notifications";
import { BRAND, palettes, WHITE, type ThemeName } from "@/lib/theme";

import { nextCheckIn, type WidgetData } from "./data";

export const WIDGETS = {
  Today: { label: "Today", size: { width: 170, height: 170 } },
  CheckIn: { label: "Next check-in", size: { width: 170, height: 170 } },
  LogExpense: { label: "Log an expense", size: { width: 340, height: 84 } },
  Week: { label: "Last 7 days", size: { width: 340, height: 220 } },
} as const;
export type WidgetName = keyof typeof WIDGETS;
export const WIDGET_NAMES = Object.keys(WIDGETS) as WidgetName[];

const F = {
  regular: "Geist_400Regular",
  medium: "Geist_500Medium",
  semibold: "Geist_600SemiBold",
  bold: "Geist_700Bold",
};

type Hex = `#${string}`;
type Colors = { card: Hex; fg: Hex; muted: Hex; bar: Hex; track: Hex; button: Hex; onButton: Hex; danger: Hex };

function colorsFor(name: ThemeName): Colors {
  const p = palettes[name];
  const light = name === "light";
  return {
    card: (light ? WHITE : p.surface) as Hex,
    fg: p.fg as Hex,
    muted: p.muted as Hex,
    bar: (light ? p.surface : p.line) as Hex,
    track: (light ? p.line : p.line) as Hex,
    button: p.fg as Hex,
    onButton: (light ? WHITE : p.bg) as Hex,
    danger: p.danger as Hex,
  };
}

const HOME = "finlyt:///";
const open = (uri: string) => ({ clickAction: "OPEN_URI", clickActionData: { uri } });

function Card({ c, uri, padding = 18, children }: { c: Colors; uri: string; padding?: number; children: React.ReactNode }) {
  return (
    <FlexWidget
      {...open(uri)}
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: c.card,
        borderRadius: 28,
        padding,
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      {children}
    </FlexWidget>
  );
}

function Label({ c, text }: { c: Colors; text: string }) {
  return <TextWidget text={text} style={{ fontSize: 14, fontFamily: F.regular, color: c.muted }} />;
}

function Big({ c, text }: { c: Colors; text: string }) {
  return <TextWidget text={text} style={{ fontSize: 30, fontFamily: F.bold, color: c.fg, letterSpacing: -0.02 }} />;
}

/** "11 PM", "6:30 PM". */
function clock({ hour, minute }: ReminderTime): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
}

function ring(progress: number, track: string, color: string): string {
  const r = 16;
  const length = 2 * Math.PI * r;
  const arc = Math.max(0, Math.min(1, progress)) * length;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
    <circle cx="20" cy="20" r="${r}" fill="none" stroke="${track}" stroke-width="5"/>
    ${arc > 0 ? `<circle cx="20" cy="20" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${length.toFixed(2)}" transform="rotate(-90 20 20)"/>` : ""}
  </svg>`;
}

function SignedOut({ c }: { c: Colors }) {
  return (
    <Card c={c} uri={HOME}>
      <Label c={c} text="Finlyt" />
      <TextWidget text="Sign in to see your spending" style={{ fontSize: 15, fontFamily: F.medium, color: c.fg }} />
    </Card>
  );
}

function Today({ d, c }: { d: WidgetData; c: Colors }) {
  const limit = d.dailyLimit;
  const over = limit != null && d.todaySpent > limit;
  return (
    <Card c={c} uri={HOME}>
      <FlexWidget style={{ width: "match_parent", flexDirection: "row", justifyContent: "space-between" }}>
        <Label c={c} text="Today" />
        {limit ? (
          <SvgWidget
            svg={ring(d.todaySpent / limit, c.track, over ? c.danger : BRAND)}
            style={{ width: 40, height: 40 }}
          />
        ) : null}
      </FlexWidget>
      <FlexWidget style={{ flexDirection: "column" }}>
        <Big c={c} text={formatPaise(d.todaySpent)} />
        <TextWidget
          text={
            limit == null
              ? "No daily limit yet"
              : over
                ? `${formatPaise(d.todaySpent - limit)} over ${formatPaise(limit)}`
                : `of ${formatPaise(limit)}`
          }
          style={{ fontSize: 14, fontFamily: F.regular, color: over ? c.danger : c.muted }}
        />
      </FlexWidget>
    </Card>
  );
}

function CheckIn({ d, c }: { d: WidgetData; c: Colors }) {
  const next = nextCheckIn(d.reminders);
  const dot = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="8" height="8"><circle cx="4" cy="4" r="4" fill="${d.toLog > 0 || d.todaySpent === 0 ? BRAND : c.track}"/></svg>`;
  return (
    <Card c={c} uri={HOME}>
      <Label c={c} text={next?.tomorrow ? "Tomorrow" : "Next check-in"} />
      <FlexWidget style={{ flexDirection: "column" }}>
        <Big c={c} text={next ? clock(next.time) : "Off"} />
        <FlexWidget style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
          <SvgWidget svg={dot} style={{ width: 8, height: 8, marginRight: 7 }} />
          <TextWidget
            text={d.toLog > 0 ? `${d.toLog} to log` : d.todaySpent > 0 ? "Logged today" : "Nothing logged yet"}
            style={{ fontSize: 14, fontFamily: F.regular, color: c.muted }}
          />
        </FlexWidget>
      </FlexWidget>
    </Card>
  );
}

function LogExpense({ c, height }: { c: Colors; height: number }) {
  const button = Math.max(40, Math.min(56, height - 20));
  const mic = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${c.muted}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/></svg>`;
  const plus = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${c.onButton}" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
  return (
    <FlexWidget
      {...open(`${HOME}?compose=type`)}
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: c.card,
        borderRadius: 999,
        paddingLeft: 24,
        paddingRight: 10,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <FlexWidget {...open(`${HOME}?compose=type`)} style={{ flex: 1, height: "match_parent", justifyContent: "center" }}>
        <TextWidget text="Log an expense…" style={{ fontSize: 17, fontFamily: F.regular, color: c.muted }} />
      </FlexWidget>
      <FlexWidget
        {...open(`${HOME}?compose=voice`)}
        accessibilityLabel="Log by voice"
        style={{ width: 48, height: "match_parent", alignItems: "center", justifyContent: "center", marginRight: 6 }}
      >
        <SvgWidget svg={mic} style={{ width: 24, height: 24 }} />
      </FlexWidget>
      <FlexWidget
        {...open(`${HOME}?compose=type`)}
        accessibilityLabel="Log an expense"
        style={{
          width: button,
          height: button,
          borderRadius: button / 2,
          backgroundColor: c.button,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <SvgWidget svg={plus} style={{ width: 24, height: 24 }} />
      </FlexWidget>
    </FlexWidget>
  );
}

const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

function Week({ d, c, width, height }: { d: WidgetData; c: Colors; width: number; height: number }) {
  const pad = 20;
  const innerWidth = Math.max(120, width - pad * 2);
  // Header ~30, labels ~24, gaps ~16.
  const barsHeight = Math.max(40, height - pad * 2 - 30 - 24 - 16);
  const max = Math.max(1, ...d.week.map((w) => w.spend));
  const column = innerWidth / 7;
  const barWidth = column * 0.74;
  const radius = Math.min(9, barWidth / 4);
  const bars = d.week
    .map((w, i) => {
      const h = Math.max(barsHeight * 0.14, (w.spend / max) * barsHeight);
      const x = i * column + (column - barWidth) / 2;
      const fill = i === d.week.length - 1 ? BRAND : c.bar;
      return `<rect x="${x.toFixed(1)}" y="${(barsHeight - h).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="${radius.toFixed(1)}" fill="${fill}"/>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${innerWidth.toFixed(1)} ${barsHeight.toFixed(1)}" width="${innerWidth.toFixed(1)}" height="${barsHeight.toFixed(1)}">${bars}</svg>`;
  const total = d.week.reduce((sum, w) => sum + w.spend, 0);

  return (
    <Card c={c} uri={`${HOME}history`} padding={pad}>
      <FlexWidget style={{ width: "match_parent", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Label c={c} text="Last 7 days" />
        <TextWidget text={formatPaise(total)} style={{ fontSize: 22, fontFamily: F.bold, color: c.fg }} />
      </FlexWidget>
      <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
        <SvgWidget svg={svg} style={{ width: innerWidth, height: barsHeight }} />
        <FlexWidget style={{ flexDirection: "row", width: "match_parent", marginTop: 8 }}>
          {d.week.map((w, i) => {
            const today = i === d.week.length - 1;
            return (
              <FlexWidget key={w.day} style={{ flex: 1, alignItems: "center" }}>
                <TextWidget
                  text={DAY_LETTER[new Date(`${w.day}T12:00:00`).getDay()]}
                  style={{ fontSize: 13, fontFamily: today ? F.semibold : F.regular, color: today ? c.fg : c.muted }}
                />
              </FlexWidget>
            );
          })}
        </FlexWidget>
      </FlexWidget>
    </Card>
  );
}

function draw(name: WidgetName, d: WidgetData, theme: ThemeName, size: { width: number; height: number }) {
  const c = colorsFor(theme);
  if (name === "LogExpense") return <LogExpense c={c} height={size.height} />;
  if (!d.signedIn) return <SignedOut c={c} />;
  if (name === "Today") return <Today d={d} c={c} />;
  if (name === "CheckIn") return <CheckIn d={d} c={c} />;
  return <Week d={d} c={c} width={size.width} height={size.height} />;
}

/** The widget in the app's theme. Auto follows the phone: Light by day, Ink in dark mode. */
export function renderFinlytWidget(
  name: WidgetName,
  d: WidgetData,
  size: { width: number; height: number },
): WidgetRepresentation {
  if (d.theme === "auto") return { light: draw(name, d, "light", size), dark: draw(name, d, "dark", size) };
  return draw(name, d, d.theme, size);
}

/** A single drawing for in-app previews (WidgetPreview takes one element). */
export function previewFinlytWidget(name: WidgetName, d: WidgetData, theme: ThemeName, size: { width: number; height: number }) {
  return draw(name, d, theme, size);
}
