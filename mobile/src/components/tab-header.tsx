// The top bar on every tab: the Finlyt logo on the left, like Home, and your photo on the right
// (it opens Settings). Ask puts its own buttons on the right instead.
import { router } from "expo-router";

import { useAuth } from "@/lib/auth";

import { AvatarButton } from "./avatar";
import { HeaderLogo } from "./brand";

export function TabLogo() {
  return <HeaderLogo height={26} />;
}

export function HeaderAvatar() {
  const { user } = useAuth();
  return <AvatarButton user={user} onPress={() => router.push("/settings")} />;
}
