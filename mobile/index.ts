// The app's entry: Expo Router, plus the handler Android calls to draw home-screen widgets.
import "expo-router/entry";

import { registerWidgetTaskHandler } from "react-native-android-widget";

import { widgetTaskHandler } from "./src/widgets/task-handler";

registerWidgetTaskHandler(widgetTaskHandler);
