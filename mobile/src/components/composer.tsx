// The chat-style input at the bottom of Home: type the way you talk, or tap the mic and talk.
// Speech becomes text on the phone (so simple notes skip AI entirely); builds without the
// speech module fall back to recording a voice note for Gemini.
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
  type RecordingStatus,
} from "expo-audio";
import { ArrowUp, AudioLines, Mic, Square, X } from "lucide-react-native";
import { useRef } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";

import { logDraft, useLogDraft } from "@/lib/log-draft";
import { useDictation } from "@/lib/speech";
import { BRAND, fonts, useTheme, WHITE } from "@/lib/theme";

import { Icon, IconButton, Txt } from "./ui";

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

export function Composer({
  busy,
  placeholder,
  hints,
  onSend,
  onError,
}: {
  busy: boolean;
  placeholder: string;
  /** Words the speech recognizer should expect: accounts, people, places. */
  hints: string[];
  onSend: () => void;
  onError: (message: string) => void;
}) {
  const { colors } = useTheme();
  const { text, note } = useLogDraft();
  const startedAt = useRef(0);

  // ── Speech to text ─────────────────────────────────────────────────────────
  const dictation = useDictation(logDraft.setText, (message) => logDraft.notice(message));
  const listening = dictation.listening;

  async function toggleListening() {
    if (listening) {
      dictation.stop();
      return;
    }
    const started = await dictation.start(logDraft.get().text, hints);
    if (!started) await toggleRecording(); // no speech-to-text on this build or phone: voice note
  }

  // Fires when recording stops, whether tapped or at the time limit.
  const onStatus = (status: RecordingStatus) => {
    if (status.hasError) onError(status.error ?? "Recording failed");
    if (status.isFinished && status.url) {
      logDraft.setNote({ uri: status.url, ms: Date.now() - startedAt.current });
    }
  };
  const recorder = useAudioRecorder(VOICE_NOTE, onStatus);
  const recording = useAudioRecorderState(recorder, 250);

  async function toggleRecording() {
    try {
      if (recording.isRecording) {
        await recorder.stop();
        return;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onError("Allow the microphone in Android settings to send voice notes.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      logDraft.setNote(null);
      await recorder.prepareToRecordAsync();
      startedAt.current = Date.now();
      recorder.record({ forDuration: MAX_SECONDS });
    } catch (e) {
      console.warn("[composer] recording failed", e);
      onError(`Recording failed: ${(e as Error).message}`);
    }
  }

  const active = listening || recording.isRecording;
  const canSend = !busy && !active && (text.trim().length > 0 || note !== null);

  return (
    <View className="rounded-[28px] bg-surface p-1.5">
      {note && !recording.isRecording ? (
        <View className="mx-1.5 mt-1 flex-row items-center gap-2 self-start rounded-full bg-bg py-1.5 pl-3 pr-1.5">
          <Icon icon={AudioLines} size={16} tone="accent" />
          <Txt weight="medium" className="text-sm">
            Voice note · {clock(note.ms)}
          </Txt>
          <Pressable
            onPress={() => logDraft.setNote(null)}
            accessibilityLabel="Remove voice note"
            hitSlop={8}
            className="h-6 w-6 items-center justify-center rounded-full"
            disabled={busy}
          >
            <Icon icon={X} size={14} tone="muted" />
          </Pressable>
        </View>
      ) : null}

      <View className="flex-row items-end">
        {recording.isRecording ? (
          <View className="h-11 flex-1 flex-row items-center gap-2.5 px-3">
            <View className="h-2.5 w-2.5 rounded-full bg-danger" />
            <Txt weight="medium">Listening · {clock(recording.durationMillis)}</Txt>
          </View>
        ) : (
          <TextInput
            value={text}
            onChangeText={logDraft.setText}
            placeholder={listening ? "Listening…" : placeholder}
            placeholderTextColor={colors.faint}
            multiline
            editable={!busy && !listening}
            className="max-h-32 min-h-11 flex-1 px-3 py-2.5 text-base text-fg"
            style={{ fontFamily: fonts.regular }}
            textAlignVertical="center"
          />
        )}

        <IconButton
          icon={active ? Square : Mic}
          label={active ? "Stop" : "Talk"}
          onPress={() => void (recording.isRecording ? toggleRecording() : toggleListening())}
          tone={active ? "danger" : "muted"}
          disabled={busy}
        />
        <Pressable
          onPress={onSend}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send"
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: BRAND, opacity: canSend || busy ? 1 : 0.3 }}
        >
          {busy ? <ActivityIndicator color={WHITE} /> : <ArrowUp size={22} color={WHITE} strokeWidth={2} />}
        </Pressable>
      </View>
    </View>
  );
}
