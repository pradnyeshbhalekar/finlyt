import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { Button, Card, Muted, Screen, Title } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import {
  formatTime,
  getReminderTimes,
  parseTime,
  saveReminderTimes,
  sendTestReminder,
  type ReminderTime,
} from "@/lib/notifications";

export default function Settings() {
  const { user, signOut } = useAuth();
  const [times, setTimes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [reminderNote, setReminderNote] = useState<string | null>(null);
  const [serverNote, setServerNote] = useState<string | null>(null);

  useEffect(() => {
    void getReminderTimes().then((saved) => setTimes(saved.map(formatTime)));
  }, []);

  async function saveTimes() {
    const parsed = times.map(parseTime);
    if (parsed.some((t) => t === null)) {
      setReminderNote("Use 24-hour times like 12:00 or 18:30.");
      return;
    }
    setSaving(true);
    try {
      const count = await saveReminderTimes(parsed as ReminderTime[]);
      setReminderNote(
        count
          ? `${count} daily reminders set.`
          : "Notifications are off for Finlyt. Turn them on in Android settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function testServer() {
    setServerNote("Checking…");
    try {
      await api("/api/health?db=1", { auth: false });
      setServerNote("Connected, database OK ✓");
    } catch (e) {
      setServerNote((e as Error).message);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerClassName="p-4 pb-28" keyboardShouldPersistTaps="handled">
        <Title>Settings</Title>

        <Card className="mt-4">
          <Text className="font-semibold text-ink dark:text-white">Account</Text>
          <Muted className="mt-1">{user?.email ?? "Signed in"}</Muted>
          <View className="mt-3">
            <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
          </View>
        </Card>

        <Card className="mt-4">
          <Text className="font-semibold text-ink dark:text-white">Daily reminders</Text>
          <Muted className="mt-1">24-hour times. Tapping a reminder opens the Log tab.</Muted>
          <View className="mt-3 flex-row gap-3">
            {times.map((value, i) => (
              <TextInput
                key={i}
                value={value}
                onChangeText={(text) => setTimes(times.map((t, j) => (j === i ? text : t)))}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                className="flex-1 rounded-xl border border-zinc-300 bg-white py-3 text-center text-base text-ink dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              />
            ))}
          </View>
          <View className="mt-3 gap-2">
            <Button label="Save reminders" onPress={() => void saveTimes()} loading={saving} />
            <Button
              label="Send a test reminder in 5 s"
              variant="secondary"
              onPress={() => void sendTestReminder()}
            />
          </View>
          {reminderNote ? <Muted className="mt-2">{reminderNote}</Muted> : null}
        </Card>

        <Card className="mt-4">
          <Text className="font-semibold text-ink dark:text-white">Server</Text>
          <Muted className="mt-1">{API_URL || "EXPO_PUBLIC_API_URL isn't set"}</Muted>
          <View className="mt-3">
            <Button label="Test connection" variant="secondary" onPress={() => void testServer()} />
          </View>
          {serverNote ? <Muted className="mt-2">{serverNote}</Muted> : null}
        </Card>

        <Muted className="mt-6 text-center">Finlyt {Constants.expoConfig?.version}</Muted>
      </ScrollView>
    </Screen>
  );
}
