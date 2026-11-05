// Reads new bank SMS on the phone and uploads only those from the user's banks (Kotak, DNS…).
// Everything else, OTPs included, never leaves the phone.
import * as SecureStore from "expo-secure-store";
import { PermissionsAndroid, Platform } from "react-native";

import { SmsReader, type InboxMessage } from "../../modules/sms-reader";
import { api } from "./api";
import type { BankTxnItem, SmsFilter } from "./types";

const CURSOR_KEY = "finlyt.smsCursor";
const BATCH = 200;
const OTP = /\b(?:otp|one[- ]time password|verification code)\b/i;

export function smsSupported(): boolean {
  return Platform.OS === "android" && SmsReader !== null;
}

export function smsPermitted(): boolean {
  try {
    return SmsReader?.hasPermission() ?? false;
  } catch {
    return false;
  }
}

export async function askSmsPermission(): Promise<boolean> {
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
    title: "Pick up bank payments",
    message: "Finlyt reads only your bank's SMS to list payments for you to explain. Other messages stay on your phone.",
    buttonPositive: "Allow",
    buttonNegative: "Not now",
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function isBankSms(m: InboxMessage, filters: SmsFilter[]): boolean {
  if (!/[a-z]/i.test(m.sender)) return false; // phone numbers are people, not banks
  if (OTP.test(m.body)) return false;
  const sender = m.sender.toLowerCase();
  const body = m.body.toLowerCase();
  return filters.some(
    (f) =>
      f.sender_patterns.some((p) => sender.includes(p.toLowerCase())) ||
      f.body_markers.some((k) => body.includes(k.toLowerCase())),
  );
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

let running: Promise<number> | null = null;

/** Upload bank SMS that arrived since the last sync. Returns how many new payments to log. */
export function syncSms(filters: SmsFilter[]): Promise<number> {
  if (!smsSupported() || !smsPermitted() || filters.length === 0 || !SmsReader) return Promise.resolve(0);
  const reader = SmsReader;
  running ??= (async () => {
    const saved = await SecureStore.getItemAsync(CURSOR_KEY);
    let cursor = saved ? Number(saved) : startOfToday(); // first sync: today's messages
    let found = 0;
    for (let round = 0; round < 10; round++) {
      const batch = await reader.readInbox(cursor, BATCH);
      if (batch.length === 0) break;
      const bank = batch.filter((m) => isBankSms(m, filters));
      if (bank.length > 0) {
        const result = await api<{ new_txns: BankTxnItem[] }>("/api/sms/sync", {
          method: "POST",
          body: {
            messages: bank.map((m) => ({
              device_id: m.id,
              sender: m.sender,
              body: m.body,
              received_at: new Date(m.date).toISOString(),
            })),
          },
        });
        found += result.new_txns.length;
      }
      // Only move the cursor once the batch is safely on the server.
      cursor = batch[batch.length - 1].date;
      await SecureStore.setItemAsync(CURSOR_KEY, String(cursor));
      if (batch.length < BATCH) break;
    }
    return found;
  })().finally(() => {
    running = null;
  });
  return running;
}
