// Android's launch screen in the theme picked in Finlyt (Android 13+). Optional, so builds
// without the module keep working.
import { requireOptionalNativeModule } from "expo";

type SplashThemeModule = { set(name: "Light" | "Dark" | "Ink" | "Default"): boolean };

export const SplashTheme = requireOptionalNativeModule<SplashThemeModule>("SplashTheme");
