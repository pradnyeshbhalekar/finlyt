// Inlined at build time from mobile/.env (only static `process.env.EXPO_PUBLIC_*` reads work).
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!API_URL) missing.push("EXPO_PUBLIC_API_URL");
  if (!GOOGLE_WEB_CLIENT_ID) missing.push("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID");
  return missing;
}
