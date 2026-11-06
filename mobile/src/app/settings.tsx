import Constants from "expo-constants";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Bell, LogOut, Pencil, Plug, Sparkles } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";

import { ReminderEditor } from "@/components/reminder-editor";
import { Avatar } from "@/components/profile-menu";
import { Divider, Icon, Row, SectionLabel, Segmented, SwitchRow, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import {
  getReminderTimes,
  saveReminderTimes,
  sendTestReminder,
  type ReminderTime,
} from "@/lib/notifications";
import { usePrefs } from "@/lib/prefs";
import { useConnectToken } from "@/lib/queries";
import { WidgetGallery } from "@/components/widget-gallery";
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
  const [times, setTimes] = useState<ReminderTime[] | null>(null);
  const [reminderNote, setReminderNote] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const connect = useConnectToken();
  const [connectNote, setConnectNote] = useState<string | null>(null);

  // A separate token for an AI assistant (MCP client), copied as a ready-to-run command.
  async function connectAssistant() {
    try {
      const { token, mcp_url } = await connect.mutateAsync();
      await Clipboard.setStringAsync(
        `claude mcp add --transport http finlyt ${mcp_url} --header "Authorization: Bearer ${token}"`,
      );
      setConnectNote(
        "Copied a command. Run it in a terminal on your computer and Claude can read (not change) your Finlyt data.",
      );
    } catch (e) {
      setConnectNote((e as Error).message);
    }
  }

  useEffect(() => {
    void getReminderTimes().then(setTimes);
  }, []);



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

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-16">
      <View className="mt-2 flex-row items-center gap-4">
        <Avatar user={user} size={48} />
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

      <SectionLabel className="mb-3 mt-10">Home screen widgets</SectionLabel>
      <WidgetGallery width={width - 40} />

      <SectionLabel className="mb-1 mt-10">AI assistants</SectionLabel>
      <View className="-mx-3">
        <Row
          onPress={() => void connectAssistant()}
          leading={<Icon icon={Plug} size={20} tone="muted" />}
          title="Connect Claude (MCP)"
          subtitle="Let an AI assistant read your spending to answer questions"
        />
      </View>
      {connectNote ? (
        <Txt tone="muted" className="mt-1 text-sm">
          {connectNote}
        </Txt>
      ) : null}

      <Divider className="mt-8" />
      <View className="-mx-3 mt-2">
        <Row
          onPress={() => prefs.update({ onboarded: false })}
          leading={<Icon icon={Sparkles} size={20} tone="muted" />}
          title="Replay the welcome"
          subtitle="Go through the setup steps again"
        />
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
