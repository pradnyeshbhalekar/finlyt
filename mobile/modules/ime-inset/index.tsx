// Reports the keyboard's height from inside a React Native Modal (a separate Android window that
// the app's other keyboard trackers can't see). Optional: without the module, nothing is reported.
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

export type ImeInsets = { keyboard: number; navigation: number; duration: number };

type Props = ViewProps & { onInsets?: (event: NativeSyntheticEvent<ImeInsets>) => void };

export const ImeInsetView: ComponentType<Props> | null = requireOptionalNativeModule("ImeInset")
  ? requireNativeView<Props>("ImeInset")
  : null;
