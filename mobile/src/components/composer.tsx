// The chat-style input at the bottom of Home: type the way you talk, tap the mic and talk, or tap
// + for the other ways to add (a form, a receipt, a bank SMS). Talking opens a full-screen
// listening view (VoiceOverlay); when you stop, the words fly down into this box and are sent.
// Speech becomes text on the phone (so simple notes skip AI entirely); builds without the speech
// module fall back to recording a voice note for Gemini, in the same full-screen view.
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
  type RecordingStatus,
} from "expo-audio";
import { ArrowUp, AudioLines, Mic, Plus, Square, X } from "lucide-react-native";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";

import { logDraft, useLogDraft } from "@/lib/log-draft";
import { useDictation } from "@/lib/speech";
import { BRAND, fonts, useTheme, WHITE } from "@/lib/theme";

import { TourTarget } from "./tour";
import { Icon, IconButton, Txt } from "./ui";
import { useVoiceLevel, VoiceOverlay, type Box, type VoicePhase } from "./voice-overlay";

const MAX_SECONDS = 180;

// Mono AAC in an ADTS stream (.aac): about 4 KB a second, and a format Gemini reads directly.
const VOICE_NOTE: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: ".aac",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: true,
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
  onAddByHand,
  launch,
  onLaunched,
}: {
  /** Shows a + at the start that opens the other ways to add. */
  onAddByHand?: () => void;
  /** Opened from the home-screen widget: start typing (keyboard up) or talking (mic on). */
  launch?: "type" | "voice";
  onLaunched?: () => void;
  busy: boolean;
  placeholder: string;
  /** Words the speech recognizer should expect: accounts, people, places. */
  hints: string[];
  /** Also called by itself once spoken words have landed in the box. */
  onSend: () => void;
  onError: (message: string) => void;
}) {
  const { colors } = useTheme();
  const { text, note } = useLogDraft();
  const startedAt = useRef(0);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const box = useRef<ComponentRef<typeof View>>(null);

  // ── The full-screen listening view ─────────────────────────────────────────
  const [phase, setPhase] = useState<VoicePhase | null>(null);
  const [mode, setMode] = useState<"speech" | "recording">("speech");
  const [heard, setHeard] = useState("");
  const [target, setTarget] = useState<Box | null>(null);
  const level = useVoiceLevel();
  // What was in the box before talking, to put back on Cancel.
  const before = useRef("");
  const cancelled = useRef(false);

  function open(next: "speech" | "recording") {
    cancelled.current = false;
    before.current = logDraft.get().text;
    setHeard("");
    setMode(next);
    level.reset();
    setPhase("listening");
  }

  function close() {
    setPhase(null);
    level.reset();
  }

  /** Measure where the box is, then fly the words into it. */
  function land() {
    const view = box.current;
    if (!view) {
      setTarget(null);
      setPhase("landing");
      return;
    }
    view.measureInWindow((x, y, width, height) => {
      setTarget(width > 0 ? { x, y, width, height } : null);
      setPhase("landing");
    });
  }

  function landed() {
    close();
    onSend();
  }

  // ── Speech to text ─────────────────────────────────────────────────────────
  const dictation = useDictation(
    (full, words) => {
      logDraft.setText(full);
      setHeard(words);
    },
    (message) => {
      close();
      logDraft.notice(message);
    },
    {
      onVolume: level.set,
      onEnd: (words) => {
        if (cancelled.current) return;
        if (words.trim()) land();
        else close(); // nothing heard; the error (if any) is already under the box
      },
    },
  );
  const listening = dictation.listening;

  async function toggleListening() {
    if (listening) {
      dictation.stop();
      return;
    }
    open("speech");
    const started = await dictation.start(logDraft.get().text, hints);
    if (!started) await toggleRecording(); // no speech-to-text on this build or phone: voice note
  }

  // Fires when recording stops, whether tapped or at the time limit.
  const onStatus = (status: RecordingStatus) => {
    if (status.hasError) {
      close();
      onError(status.error ?? "Recording failed");
    }
    if (status.isFinished && status.url) {
      if (cancelled.current) return;
      const ms = Date.now() - startedAt.current;
      logDraft.setNote({ uri: status.url, ms });
      setHeard(`Voice note · ${clock(ms)}`);
      land();
    }
  };
  const recorder = useAudioRecorder(VOICE_NOTE, onStatus);
  const recording = useAudioRecorderState(recorder, 120);

  // The orb follows the recording's loudness too (metering is in dB, about -60 to 0).
  useEffect(() => {
    if (recording.isRecording && typeof recording.metering === "number") {
      level.set(Math.min(Math.max((recording.metering + 50) / 45, 0), 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording.metering, recording.isRecording]);

  async function toggleRecording() {
    try {
      if (recording.isRecording) {
        await recorder.stop();
        return;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        close();
        onError("Allow the microphone in Android settings to send voice notes.");
        return;
      }
      if (phase === null) open("recording");
      else setMode("recording");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      logDraft.setNote(null);
      await recorder.prepareToRecordAsync();
      startedAt.current = Date.now();
      recorder.record({ forDuration: MAX_SECONDS });
    } catch (e) {
      console.warn("[composer] recording failed", e);
      close();
      onError(`Recording failed: ${(e as Error).message}`);
    }
  }

  /** The big stop button: finish, and the words fly into the box. */
  function stopTalking() {
    if (recording.isRecording) void recorder.stop();
    else if (listening) dictation.stop();
    else close();
  }

  /** Close without keeping anything. */
  function cancelTalking() {
    cancelled.current = true;
    if (recording.isRecording) void recorder.stop();
    if (listening) dictation.abort();
    logDraft.setText(before.current);
    close();
  }

  useEffect(() => {
    if (!launch) return;
    // Give the screen a moment to settle (and the keyboard a view to attach to).
    const timer = setTimeout(() => {
      if (launch === "voice") void toggleListening();
      else input.current?.focus();
      onLaunched?.();
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch]);

  const active = listening || recording.isRecording;
  const canSend = !busy && !active && (text.trim().length > 0 || note !== null);

  return (
    <View ref={box} collapsable={false} className="rounded-[28px] bg-surface p-1.5">
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
        {onAddByHand && !active ? (
          <TourTarget id="add-by-hand">
            <IconButton icon={Plus} label="More ways to add" onPress={onAddByHand} tone="muted" disabled={busy} />
          </TourTarget>
        ) : null}
        {recording.isRecording ? (
          <View className="h-11 flex-1 flex-row items-center gap-2.5 px-3">
            <View className="h-2.5 w-2.5 rounded-full bg-danger" />
            <Txt weight="medium">Listening · {clock(recording.durationMillis)}</Txt>
          </View>
        ) : (
          <TextInput
            ref={input}
            value={text}
            onChangeText={logDraft.setText}
            placeholder={listening ? "Listening…" : placeholder}
            placeholderTextColor={colors.faint}
            multiline
            editable={!busy && !listening}
            className={`max-h-32 min-h-11 flex-1 py-2.5 pr-3 text-base text-fg ${onAddByHand ? "pl-1" : "pl-3"}`}
            style={{ fontFamily: fonts.regular }}
            textAlignVertical="center"
          />
        )}

        <TourTarget id="mic">
          <IconButton
            icon={active ? Square : Mic}
            label={active ? "Stop" : "Talk"}
            onPress={() => void (recording.isRecording ? toggleRecording() : toggleListening())}
            tone={active ? "danger" : "muted"}
            disabled={busy}
          />
        </TourTarget>
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

      <VoiceOverlay
        phase={phase}
        heard={heard}
        mode={mode}
        level={level.level}
        elapsedMs={recording.durationMillis}
        target={target}
        onStop={stopTalking}
        onCancel={cancelTalking}
        onLanded={landed}
      />
    </View>
  );
}
