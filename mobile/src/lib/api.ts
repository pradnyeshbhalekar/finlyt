import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let getToken: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

/** Called once by AuthProvider so every request carries the session token. */
export function configureApi(options: { getToken: () => string | null; onUnauthorized: () => void }) {
  getToken = options.getToken;
  onUnauthorized = options.onUnauthorized;
}

function networkError(method: string, path: string, e: unknown): ApiError {
  console.warn(`[api] ${method} ${path} failed before reaching the server`, e);
  const text = String(e);
  const offline = /UnknownHost|resolve host|Network request failed|ENOTFOUND|timed? ?out/i.test(text);
  return new ApiError(
    0,
    "network",
    offline
      ? "You're offline, or the network dropped for a moment. Check Wi-Fi or mobile data and try again."
      : `Can't reach the Finlyt server (${text})`,
  );
}

export function queryString(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; form?: FormData; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, form, auth = true } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  // Multipart bodies (voice notes) get their Content-Type and boundary from fetch itself.
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const send = () =>
    fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  let response: Response;
  try {
    response = await send();
  } catch (first) {
    // Phones drop Wi-Fi or DNS for a moment when switching networks. Reads are safe to retry;
    // writes aren't (the first try might have reached the server), so they fail straight away.
    if (method !== "GET") throw networkError(method, path, first);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      response = await send();
    } catch (second) {
      throw networkError(method, path, second);
    }
  }

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data?.error ?? {};
    if (response.status === 401 && auth) onUnauthorized();
    // Flask's own 404 means the route itself is missing (an older server), not a missing record.
    const missingRoute =
      response.status === 404 && String(error.message ?? "").startsWith("The requested URL was not found");
    throw new ApiError(
      response.status,
      error.code ?? "http_error",
      missingRoute
        ? "Your Finlyt server doesn't have this yet. It needs a backend deploy."
        : (error.message ?? `Request failed (${response.status})`),
      error.details,
    );
  }
  return data as T;
}
