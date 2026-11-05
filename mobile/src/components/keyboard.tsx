// Android draws edge to edge, so the window no longer shrinks when the keyboard opens and
// KeyboardAvoidingView can't see it. This wraps the bottom of a screen (the composer, a Save
// button) and lifts it by the keyboard's live height, so what you type stays in view.
import type { ReactNode } from "react";
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function KeyboardAware({ children, rest }: { children?: ReactNode; rest?: number }) {
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  // Padding when the keyboard is closed: clear the gesture bar (or `rest` if given).
  const closed = rest ?? Math.max(insets.bottom, 12);
  const style = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboard.height.value + 8, closed),
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
