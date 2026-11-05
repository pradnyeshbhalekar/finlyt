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
export function dictationOptions(hints: string[]): ExpoSpeechRecognitionOptions {
  return {
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

/**
 * Talk into a text box: `start(current)` listens and calls `onText(current + what's heard)` as
 * words come in. `onError` gets a short message. `available` is false on builds without speech.
 */
export function useDictation(onText: (text: string) => void, onError: (message: string) => void) {
  const [listening, setListening] = useState(false);
  const before = useRef("");
  const handlers = useRef({ onText, onError });
  useEffect(() => {
    handlers.current = { onText, onError };
  });

  useEffect(() => {
    if (!speech) return;
    const subscriptions = [
      speech.addListener("start", () => setListening(true)),
      speech.addListener("end", () => setListening(false)),
      speech.addListener("result", (event) => {
        const heard = event.results[0]?.transcript?.trim() ?? "";
        const base = before.current;
        handlers.current.onText(base && heard ? `${base} ${heard}` : base || heard);
      }),
      speech.addListener("error", (event) => {
        setListening(false);
        if (event.error === "aborted") return;
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
    speech.start(dictationOptions(hints));
    return true;
  }

  function stop() {
    speech?.stop();
  }

  return { listening, start, stop, available: speech !== null };
}
