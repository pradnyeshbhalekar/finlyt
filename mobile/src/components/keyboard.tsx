// Android draws edge to edge, so the window no longer shrinks when the keyboard opens and
// KeyboardAvoidingView can't see it. This wraps the bottom of a screen (the composer, a Save
// button) and lifts it by the keyboard's live height, so what you type stays in view.
import type { ReactNode } from "react";
import Animated, { KeyboardState, useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function KeyboardAware({
  children,
  rest,
  offset = 0,
}: {
  children?: ReactNode;
  rest?: number;
  /** Space below this screen that the keyboard also covers, such as the bottom bar. */
  offset?: number;
}) {
  const insets = useSafeAreaInsets();
  // Edge-to-edge is always on, so no translucency options are needed (they'd be ignored).
  const keyboard = useAnimatedKeyboard();
  // Padding when the keyboard is closed: clear the gesture bar (or `rest` if given).
  const closed = rest ?? Math.max(insets.bottom, 12);
  const style = useAnimatedStyle(() => {
    // A height can linger after the keyboard has gone (seen on Android after pasting on one
    // screen and opening another), so only count it while the keyboard is opening, open or closing.
    const state = keyboard.state.value;
    const up = state === KeyboardState.OPENING || state === KeyboardState.OPEN || state === KeyboardState.CLOSING;
    return { paddingBottom: Math.max((up ? keyboard.height.value : 0) - offset + 8, closed) };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}
