// On-device speech-to-text (Android's SpeechRecognizer via expo-speech-recognition).
// Loaded as an optional native module so an app build without it falls back to voice notes
// instead of crashing. Only types are imported from the package.
import { requireOptionalNativeModule } from "expo";
import type { ExpoSpeechRecognitionOptions } from "expo-speech-recognition";
import { useEffect, useRef, useState } from "react";

type SpeechModule = (typeof import("expo-speech-recognition"))["ExpoSpeechRecognitionModule"];

export const speech = requireOptionalNativeModule<SpeechModule>("ExpoSpeechRecognition");

export function speechAvailable(): boolean {
  try {
    return speech?.isRecognitionAvailable() ?? false;
  } catch {
    return false;
  }
}

/** Indian English, words appear as you speak, stops after a short pause. */
export function dictationOptions(hints: string[], volume = false): ExpoSpeechRecognitionOptions {
  return {
    // How loud the voice is, for the listening screen's orb (Android sends about 10 a second).
    ...(volume ? { volumeChangeEventOptions: { enabled: true, intervalMillis: 100 } } : {}),
    lang: "en-IN",
    interimResults: true,
    continuous: false,
    maxAlternatives: 1,
    addsPunctuation: false,
    contextualStrings: hints.slice(0, 50),
    androidIntentOptions: {
      EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2000,
      EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 2000,
    },
  };
}

export type DictationEvents = {
  /** The box's text with what's been heard so far added, and the heard part on its own. */
  onText: (text: string, heard: string) => void;
  onError: (message: string) => void;
  /** Listening stopped (after a pause, Stop or an error). `heard` is the final words, if any. */
  onEnd?: (heard: string) => void;
  /** Loudness from 0 (silence) to 1, about 10 times a second. */
  onVolume?: (level: number) => void;
};

/**
 * Talk into a text box: `start(current)` listens and calls `onText(current + what's heard)` as
 * words come in. `onError` gets a short message. `available` is false on builds without speech.
 */
export function useDictation(onText: DictationEvents["onText"], onError: DictationEvents["onError"], more: Omit<DictationEvents, "onText" | "onError"> = {}) {
  const [listening, setListening] = useState(false);
  const before = useRef("");
  const heard = useRef("");
  const aborted = useRef(false);
  const handlers = useRef<DictationEvents>({ onText, onError, ...more });
  useEffect(() => {
    handlers.current = { onText, onError, ...more };
  });

  useEffect(() => {
    if (!speech) return;
    const subscriptions = [
      speech.addListener("start", () => setListening(true)),
      speech.addListener("end", () => {
        setListening(false);
        if (!aborted.current) handlers.current.onEnd?.(heard.current);
      }),
      speech.addListener("result", (event) => {
        if (aborted.current) return;
        const words = event.results[0]?.transcript?.trim() ?? "";
        const base = before.current;
        heard.current = words;
        handlers.current.onText(base && words ? `${base} ${words}` : base || words, words);
      }),
      speech.addListener("volumechange", (event) => {
        handlers.current.onVolume?.(Math.min(Math.max(event.value / 10, 0), 1));
      }),
      speech.addListener("error", (event) => {
        setListening(false);
        if (event.error === "aborted" || aborted.current) return;
        handlers.current.onError(
          event.error === "no-speech" || event.error === "speech-timeout"
            ? "Didn't catch that. Tap the mic and try again."
            : `Voice input didn't work (${event.error}). You can type instead.`,
        );
      }),
    ];
    return () => subscriptions.forEach((s) => s.remove());
  }, []);

  async function start(current: string, hints: string[]): Promise<boolean> {
    if (!speech || !speechAvailable()) return false;
    const permission = await speech.requestPermissionsAsync();
    if (!permission.granted) {
      onError("Allow the microphone in Android settings to talk to Finlyt.");
      return true;
    }
    before.current = current.trim();
    heard.current = "";
    aborted.current = false;
    speech.start(dictationOptions(hints, Boolean(handlers.current.onVolume)));
    return true;
  }

  function stop() {
    speech?.stop();
  }

  /** Stop without using what was heard; `onEnd` isn't called. */
  function abort() {
    aborted.current = true;
    speech?.abort();
  }

  return { listening, start, stop, abort, available: speech !== null };
}
