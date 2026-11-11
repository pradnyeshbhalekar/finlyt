// Settings, grouped into a few calm cards: your money, logging, reminders, and more. Details live
// one tap away (reminder times in a sheet, widgets on their own screen, past imports on Import).
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { router } from "expo-router";
import {
  Bell,
  BookOpen,
  BookmarkCheck,
  CalendarClock,
  ChartColumn,
  Download,
  LayoutGrid,
  LogOut,
  Pencil,
  Sparkles,
  Target,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { Group, GroupItem, GroupLabel } from "@/components/group";
import { ReminderEditor } from "@/components/reminder-editor";
import { formatClock, TimePickerSheet } from "@/components/time-picker";
import { Button, Segmented, Sheet, Toggle, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import {
  DEFAULT_CHECK_IN,
  getCheckIn,
  getReminderTimes,
  saveCheckIn,
  saveReminderTimes,
  sendTestReminder,
  WEEKDAYS,
  type CheckIn,
  type ReminderTime,
} from "@/lib/notifications";
import { usePrefs } from "@/lib/prefs";
import { tour } from "@/lib/tour";
import { useImportBatches } from "@/lib/queries";
import type { ThemeMode } from "@/lib/theme";

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "ink", label: "Ink" },
];

function clock(t: ReminderTime): string {
  const h = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return `${h}${t.minute ? `:${String(t.minute).padStart(2, "0")}` : ""} ${t.hour < 12 ? "AM" : "PM"}`;
}

export default function Settings() {
  const { user, signOut } = useAuth();
  const prefs = usePrefs();
  const queryClient = useQueryClient();
  const imports = useImportBatches();
  const [times, setTimes] = useState<ReminderTime[] | null>(null);
  const [editingTimes, setEditingTimes] = useState(false);
  const [checkIn, setCheckIn] = useState<CheckIn>(DEFAULT_CHECK_IN);
  const [pickingCheckIn, setPickingCheckIn] = useState(false);
  const [pickRound, setPickRound] = useState(0);
  const [reminderNote, setReminderNote] = useState<string | null>(null);

  useEffect(() => {
    void getReminderTimes().then(setTimes);
    void getCheckIn().then(setCheckIn);
  }, []);

  async function changeTimes(next: ReminderTime[]) {
    setTimes(next);
    const count = await saveReminderTimes(next);
    setReminderNote(count || next.length === 0 ? null : "Notifications are off for Finlyt. Turn them on in Android settings.");
  }

  async function testReminder() {
    await sendTestReminder();
    setReminderNote("A test reminder arrives in 5 seconds.");
  }

  const importCount = imports.data?.items.length ?? 0;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-16">
      <View className="mt-2 flex-row items-center gap-4">
        <Avatar user={user} size={52} />
        <View className="flex-1">
          <Txt weight="semibold" className="text-lg" numberOfLines={1}>
            {user?.name ?? "Signed in"}
          </Txt>
          <Txt tone="muted" className="text-sm" numberOfLines={1}>
            {user?.email}
          </Txt>
        </View>
      </View>

      <GroupLabel>Appearance</GroupLabel>
      <Segmented options={THEMES} value={prefs.theme} onChange={(theme) => prefs.update({ theme })} />

      <GroupLabel>Your money</GroupLabel>
      <Group>
        <GroupItem first icon={ChartColumn} title="This month's report" onPress={() => router.push("/report")} />
        <GroupItem icon={Target} title="Savings goals" onPress={() => router.push("/goals")} />
        <GroupItem icon={BookmarkCheck} title="What Finlyt remembers" onPress={() => router.push("/memory")} />
        <GroupItem
          icon={Download}
          title="Import from an AI chat"
          subtitle={importCount ? `${importCount} ${importCount === 1 ? "import" : "imports"} so far` : undefined}
          onPress={() => router.push("/import")}
        />
      </Group>

      <GroupLabel>Logging</GroupLabel>
      <Group>
        <GroupItem
          first
          icon={Sparkles}
          title="Check before saving"
          subtitle={prefs.reviewBeforeSave ? "See what Finlyt made of it first" : "Save straight away, with Undo"}
          trailing={
            <Toggle
              value={prefs.reviewBeforeSave}
              onChange={(reviewBeforeSave) => prefs.update({ reviewBeforeSave })}
              label="Check before saving"
            />
          }
        />
        <GroupItem icon={Pencil} title="Add an entry by hand" onPress={() => router.push("/expense/new")} />
      </Group>

      <GroupLabel>Reminders</GroupLabel>
      <Group>
        <GroupItem
          first
          icon={Bell}
          title="Daily reminders"
          subtitle={times ? (times.length ? times.map(clock).join(", ") : "None") : undefined}
          onPress={() => setEditingTimes(true)}
        />
        <GroupItem
          icon={CalendarClock}
          title="Weekly check-in"
          subtitle={`${WEEKDAYS[checkIn.weekday]}, ${formatClock(checkIn)}`}
          onPress={() => {
            setPickRound((r) => r + 1);
            setPickingCheckIn(true);
          }}
        />
      </Group>
      {reminderNote && !editingTimes ? (
        <Txt tone="muted" className="ml-1 mt-2 text-sm">
          {reminderNote}
        </Txt>
      ) : null}

      <GroupLabel>More</GroupLabel>
      <Group>
        <GroupItem
          first
          icon={BookOpen}
          title="How Finlyt works"
          subtitle="A one-minute tour of the app"
          onPress={() => {
            // Back to Home first; the tour starts there.
            router.dismissTo("/");
            setTimeout(() => tour.start({ from: "settings" }), 450);
          }}
        />
        <GroupItem icon={LayoutGrid} title="Home screen widgets" onPress={() => router.push("/widgets")} />
        <GroupItem icon={Sparkles} title="Replay the welcome" onPress={() => prefs.update({ onboarded: false })} />
      </Group>

      <View className="mt-8">
        <Group>
          <GroupItem first icon={LogOut} title="Sign out" danger onPress={() => void signOut()} />
        </Group>
      </View>

      <Txt tone="faint" className="mt-8 text-center text-xs">
        Finlyt {Constants.expoConfig?.version} · {API_URL.replace(/^https?:\/\//, "")}
      </Txt>

      <Sheet visible={editingTimes} onClose={() => setEditingTimes(false)}>
        <Txt weight="semibold" className="text-lg">
          Daily reminders
        </Txt>
        <Txt tone="muted" className="mb-3 mt-1 text-sm">
          A reminder at each time opens Finlyt so you can log what you spent.
        </Txt>
        {times ? <ReminderEditor times={times} onChange={(next) => void changeTimes(next)} /> : null}
        {reminderNote ? (
          <Txt tone="muted" className="mt-2 text-sm">
            {reminderNote}
          </Txt>
        ) : null}
        <View className="mt-4 flex-row gap-3">
          <Button label="Send a test" variant="secondary" onPress={() => void testReminder()} className="flex-1" />
          <Button label="Done" onPress={() => setEditingTimes(false)} className="flex-1" />
        </View>
      </Sheet>

      <TimePickerSheet
        key={pickRound}
        visible={pickingCheckIn}
        initial={checkIn}
        initialWeekday={checkIn.weekday}
        onClose={() => setPickingCheckIn(false)}
        onDone={(time, weekday) => {
          const next = { ...time, weekday };
          setPickingCheckIn(false);
          setCheckIn(next);
          // The day decides when a check-in is due and where weeks start, so refresh the plan.
          void saveCheckIn(next).then(() => queryClient.invalidateQueries({ queryKey: ["plan"] }));
        }}
      />
    </ScrollView>
  );
}
