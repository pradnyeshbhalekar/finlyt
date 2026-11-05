import Ionicons from "@expo/vector-icons/Ionicons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
  type RecordingStatus,
} from "expo-audio";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Coin, type Mood } from "@/components/brand";
import { Button, Card, Muted, Screen, Title } from "@/components/ui";
import { logDraft, useLogDraft } from "@/lib/log-draft";
import { useProposeLog } from "@/lib/queries";
import { colors } from "@/lib/theme";

const MAX_SECONDS = 180;

// Mono AAC in an ADTS stream (.aac): about 4 KB a second, and a format Gemini reads directly.
const VOICE_NOTE: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: ".aac",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { extension: ".aac", outputFormat: "aac_adts", audioEncoder: "aac" },
};

function clock(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function restingMood(): Mood {
  const hour = new Date().getHours();
  return hour >= 22 || hour < 6 ? "sleepy" : "default";
}

// Reminders open this tab. Say or type what you spent; Gemini turns it into expenses to review.
export default function Log() {
  const { text, note, saved } = useLogDraft();
  const propose = useProposeLog();
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);

  // Fires when recording stops, whether tapped or at the time limit.
  const onStatus = (status: RecordingStatus) => {
    if (status.hasError) setError(status.error ?? "Recording failed");
    if (status.isFinished && status.url) {
      logDraft.setNote({ uri: status.url, ms: Date.now() - startedAt.current });
    }
  };
  const recorder = useAudioRecorder(VOICE_NOTE, onStatus);
  const recording = useAudioRecorderState(recorder, 250);

  async function toggleRecording() {
    setError(null);
    try {
      if (recording.isRecording) {
        await recorder.stop();
        return;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError("Finlyt needs the microphone for voice notes. Allow it in Android settings.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      logDraft.setNote(null);
      await recorder.prepareToRecordAsync();
      startedAt.current = Date.now();
      recorder.record({ forDuration: MAX_SECONDS });
    } catch (e) {
      console.warn("[log] recording failed", e);
      setError(`Recording failed: ${(e as Error).message}`);
    }
  }

  async function makeExpenses() {
    setError(null);
    try {
      const proposal = await propose.mutateAsync({ text: text.trim(), audioUri: note?.uri ?? null });
      if (
        proposal.expenses.length + proposal.settlements.length + proposal.transfers.length +
          proposal.ignored.length ===
        0
      ) {
        setError(
          proposal.questions[0] ?? "Gemini didn't find any spending in that. Try saying it differently.",
        );
        return;
      }
      logDraft.review(proposal);
      router.push("/log/review");
    } catch (e) {
      console.warn("[log] propose failed", e);
      setError((e as Error).message);
    }
  }

  const busy = propose.isPending;
  const mood: Mood = busy ? "thinking" : saved ? "happy" : restingMood();
  const canSend = !busy && !recording.isRecording && (text.trim().length > 0 || note !== null);

  return (
    <Screen>
      <ScrollView contentContainerClassName="p-4 pb-28" keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center gap-3">
          <Coin size={52} mood={mood} />
          <View className="flex-1">
            <Title>Log</Title>
            <Muted>
              {busy
                ? "Reading what you said…"
                : saved ?? "Say or type what you spent. Gemini sorts it out."}
            </Muted>
          </View>
        </View>

        <Card className="mt-4">
          <TextInput
            value={text}
            onChangeText={logDraft.setText}
            placeholder="Zomato was lunch with Rahul, he owes me 200. Auto 150, chai 40 cash"
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
            className="min-h-24 text-base text-ink dark:text-white"
            editable={!busy}
          />
        </Card>

        <View className="mt-6 items-center">
          <Pressable
            onPress={() => void toggleRecording()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={recording.isRecording ? "Stop recording" : "Record a voice note"}
            className={`h-20 w-20 items-center justify-center rounded-full ${
              recording.isRecording ? "bg-red-600 active:bg-red-700" : "bg-primary active:bg-primary-700"
            } ${busy ? "opacity-50" : ""}`}
          >
            <Ionicons name={recording.isRecording ? "stop" : "mic"} size={34} color={colors.white} />
          </Pressable>
          <Text className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {recording.isRecording
              ? `Recording ${clock(recording.durationMillis)} · tap to stop`
              : "Tap to record a voice note"}
          </Text>
        </View>

        {note && !recording.isRecording ? (
          <View className="mt-4 flex-row items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <View className="flex-row items-center gap-2">
              <Ionicons name="musical-notes-outline" size={18} color={colors.primary} />
              <Text className="text-ink dark:text-white">Voice note · {clock(note.ms)}</Text>
            </View>
            <Pressable
              onPress={() => logDraft.setNote(null)}
              accessibilityLabel="Delete voice note"
              className="p-1"
              disabled={busy}
            >
              <Ionicons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}

        {error ? <Text className="mt-4 text-sm text-red-600">{error}</Text> : null}

        <View className="mt-6 gap-3">
          <Button
            label="Make expenses"
            onPress={() => void makeExpenses()}
            loading={busy}
            disabled={!canSend}
          />
          <Button
            label="Add an expense by hand"
            variant="secondary"
            onPress={() => router.push("/expense/new")}
          />
        </View>

        <Muted className="mt-6">
          Your 12:00, 18:00 and 23:00 reminders open this screen. Payments from your Kotak and DNS
          Bank SMS will show up here too.
        </Muted>
      </ScrollView>
    </Screen>
  );
}
