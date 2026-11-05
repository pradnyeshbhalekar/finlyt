import Constants from "expo-constants";
import { router } from "expo-router";
import { Bell, CalendarClock, LogOut, MessagesSquare, Pencil } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { ReminderEditor } from "@/components/reminder-editor";
import { formatClock, TimePickerSheet } from "@/components/time-picker";
import { Divider, Icon, Row, SectionLabel, Segmented, SwitchRow, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import {
  DEFAULT_CHECK_IN,
  getCheckInTime,
  getReminderTimes,
  saveCheckInTime,
  saveReminderTimes,
  sendTestReminder,
  type ReminderTime,
} from "@/lib/notifications";
import { usePrefs } from "@/lib/prefs";
import { usePlan } from "@/lib/queries";
import type { ThemeMode } from "@/lib/theme";

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "ink", label: "Ink" },
];

export default function Settings() {
  const { user, signOut } = useAuth();
  const prefs = usePrefs();
  const planning = usePlan(); // an older server without planning: hide that section
  const [times, setTimes] = useState<ReminderTime[] | null>(null);
  const [reminderNote, setReminderNote] = useState<string | null>(null);
  const [checkIn, setCheckIn] = useState<ReminderTime>(DEFAULT_CHECK_IN);
  const [pickingCheckIn, setPickingCheckIn] = useState(false);
  const [pickerRound, setPickerRound] = useState(0);

  useEffect(() => {
    void getReminderTimes().then(setTimes);
    void getCheckInTime().then(setCheckIn);
  }, []);

  async function changeCheckIn(time: ReminderTime) {
    setPickingCheckIn(false);
    setCheckIn(time);
    await saveCheckInTime(time);
  }

  async function changeTimes(next: ReminderTime[]) {
    setTimes(next);
    const count = await saveReminderTimes(next);
    setReminderNote(
      count || next.length === 0 ? null : "Notifications are off for Finlyt. Turn them on in Android settings.",
    );
  }

  async function testReminder() {
    await sendTestReminder();
    setReminderNote("A test reminder arrives in 5 seconds.");
  }

  const initial = (user?.name ?? user?.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-16">
      <View className="mt-2 flex-row items-center gap-4">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-brand">
          <Txt weight="semibold" tone="onBrand" className="text-lg">
            {initial}
          </Txt>
        </View>
        <View className="flex-1">
          <Txt weight="semibold" className="text-lg" numberOfLines={1}>
            {user?.name ?? "Signed in"}
          </Txt>
          <Txt tone="muted" className="text-sm" numberOfLines={1}>
            {user?.email}
          </Txt>
        </View>
      </View>

      <SectionLabel className="mb-3 mt-10">Appearance</SectionLabel>
      <Segmented options={THEMES} value={prefs.theme} onChange={(theme) => prefs.update({ theme })} />

      <SectionLabel className="mb-1 mt-10">Logging</SectionLabel>
      <SwitchRow
        title="Check before saving"
        description={
          prefs.reviewBeforeSave
            ? "Gemini's entries wait for a quick look. Tap Save, or Edit to fix anything."
            : "Gemini's entries are saved straight away. You can undo right after. Entries that don't add up are still shown first."
        }
        value={prefs.reviewBeforeSave}
        onChange={(reviewBeforeSave) => prefs.update({ reviewBeforeSave })}
      />
      <View className="-mx-3">
        <Row
          onPress={() => router.push("/expense/new")}
          leading={<Icon icon={Pencil} size={20} tone="muted" />}
          title="Add an entry by hand"
        />
      </View>

      {planning.isSuccess ? (
      <>
      <SectionLabel className="mb-1 mt-10">Planning</SectionLabel>
      <View className="-mx-3">
        <Row
          onPress={() => router.push("/plan")}
          leading={<Icon icon={MessagesSquare} size={20} tone="muted" />}
          title="Talk to Finlyt"
          subtitle="Budget, planned spends and your daily limit"
        />
        <Row
          onPress={() => {
            setPickerRound((r) => r + 1);
            setPickingCheckIn(true);
          }}
          leading={<Icon icon={CalendarClock} size={20} tone="muted" />}
          title="Sunday check-in"
          subtitle={`Every Sunday at ${formatClock(checkIn)}`}
        />
      </View>
      <TimePickerSheet
        key={pickerRound}
        visible={pickingCheckIn}
        initial={checkIn}
        onClose={() => setPickingCheckIn(false)}
        onDone={(time) => void changeCheckIn(time)}
      />
      </>
      ) : null}

      <SectionLabel className="mb-1 mt-10">Check-ins</SectionLabel>
      <Txt tone="muted" className="mb-2 text-sm">
        A reminder at each time opens Finlyt so you can log what you spent.
      </Txt>
      {times ? <ReminderEditor times={times} onChange={(next) => void changeTimes(next)} /> : null}
      <View className="-mx-3">
        <Row
          onPress={() => void testReminder()}
          leading={<Icon icon={Bell} size={20} tone="muted" />}
          title="Send a test reminder"
        />
      </View>
      {reminderNote ? (
        <Txt tone="muted" className="mt-1 text-sm">
          {reminderNote}
        </Txt>
      ) : null}

      <Divider className="mt-8" />
      <View className="-mx-3 mt-2">
        <Row
          onPress={() => void signOut()}
          leading={<Icon icon={LogOut} size={20} tone="danger" />}
          title={<Txt weight="medium" tone="danger" className="text-base">Sign out</Txt>}
        />
      </View>

      <Txt tone="faint" className="mt-8 text-center text-xs">
        Finlyt {Constants.expoConfig?.version} · {API_URL.replace(/^https?:\/\//, "")}
      </Txt>
    </ScrollView>
  );
}
