// First run after signing in: pick check-in times and whether to look over Gemini's entries.
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Coin } from "@/components/brand";
import { ReminderEditor } from "@/components/reminder-editor";
import { Button, Screen, SectionLabel, SwitchRow, Txt } from "@/components/ui";
import { DEFAULT_REMINDERS, saveReminderTimes, type ReminderTime } from "@/lib/notifications";
import { usePrefs } from "@/lib/prefs";

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const prefs = usePrefs();
  const [times, setTimes] = useState<ReminderTime[]>(DEFAULT_REMINDERS);
  const [review, setReview] = useState(prefs.reviewBeforeSave);
  const [busy, setBusy] = useState(false);

  async function finish() {
    setBusy(true);
    try {
      await saveReminderTimes(times); // asks for notification permission
    } finally {
      // Switches the app to Home.
      prefs.update({ reviewBeforeSave: review, onboarded: true });
    }
  }

  return (
    <Screen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pb-8 pt-10">
        <Coin size={56} variant="bare" />
        <Txt weight="bold" className="mt-6 text-3xl" style={{ letterSpacing: -0.5 }}>
          When should I check in?
        </Txt>
        <Txt tone="muted" className="mt-2 text-base leading-6">
          I&apos;ll remind you to log what you spent. Change these any time in Settings.
        </Txt>

        <View className="mt-6">
          <ReminderEditor times={times} onChange={setTimes} />
        </View>

        <SectionLabel className="mb-1 mt-10">Logging</SectionLabel>
        <SwitchRow
          title="Check before saving"
          description="Look over what Gemini understood before it's saved. Turn off to save straight away, with an undo."
          value={review}
          onChange={setReview}
        />
      </ScrollView>
      <View className="px-6 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <Button label="Continue" onPress={() => void finish()} loading={busy} />
      </View>
    </Screen>
  );
}
