import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { useQueryClient } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";

import { api, ApiError, configureApi } from "./api";
import { GOOGLE_WEB_CLIENT_ID } from "./config";
import type { User } from "./types";

const TOKEN_KEY = "finlyt.session";
const USER_KEY = "finlyt.user";

// The ID token's audience must be the Web client; the backend checks it.
GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });

type AuthState = {
  status: "loading" | "signed-out" | "signed-in";
  user: User | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [user, setUser] = useState<User | null>(null);
  const tokenRef = useRef<string | null>(null);

  async function forget() {
    tokenRef.current = null;
    queryClient.clear();
    setUser(null);
    setStatus("signed-out");
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
  }

  useEffect(() => {
    configureApi({
      getToken: () => tokenRef.current,
      onUnauthorized: () => void forget(),
    });
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token) {
        setStatus("signed-out");
        return;
      }
      tokenRef.current = token;
      const cached = await SecureStore.getItemAsync(USER_KEY);
      if (cached) setUser(JSON.parse(cached) as User);
      setStatus("signed-in");
      try {
        const me = await api<{ user: User }>("/api/auth/me");
        setUser(me.user);
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(me.user));
      } catch {
        // Offline is fine: keep the saved session. A 401 already signed us out.
      }
    })();
    // Runs once on launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn() {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return; // the user closed the account picker
    const idToken = response.data.idToken;
    if (!idToken) {
      throw new Error("Google didn't return an ID token. Check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.");
    }
    const session = await api<{ token: string; user: User }>("/api/auth/google", {
      method: "POST",
      auth: false,
      body: { id_token: idToken, device: `${Platform.OS} ${Platform.Version}` },
    });
    tokenRef.current = session.token;
    await SecureStore.setItemAsync(TOKEN_KEY, session.token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(session.user));
    setUser(session.user);
    setStatus("signed-in");
  }

  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Still sign out locally if the server is unreachable.
    }
    try {
      await GoogleSignin.signOut(); // so the account picker shows next time
    } catch {}
    await forget();
  }

  return (
    <AuthContext.Provider value={{ status, user, signIn, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

export function describeSignInError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (isErrorWithCode(error)) {
    switch (error.code) {
      case statusCodes.IN_PROGRESS:
        return "Sign-in is already in progress.";
      case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
        return "Google Play services is missing or out of date.";
      case "10":
      case "DEVELOPER_ERROR":
        return (
          "Google sign-in isn't set up for this build. Check the Android OAuth client " +
          "(package com.finlyt.app + this build's SHA-1) and EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID."
        );
      default:
        return `Google sign-in failed (${error.code}).`;
    }
  }
  return error instanceof Error ? error.message : "Sign-in failed.";
}
