package expo.modules.splashtheme

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Makes Android's launch screen match the theme picked in Finlyt (Light, Dark or Ink). Android 13+
 * remembers the chosen splash style for the next launches. "Default" goes back to the style that
 * follows the phone's light/dark setting (for the Auto theme).
 */
class SplashThemeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SplashTheme")

    Function("set") { name: String ->
      val activity = appContext.currentActivity ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return@Function false
      val style = if (name == "Default") "Theme.App.SplashScreen" else "Theme.App.SplashScreen.$name"
      val res = activity.resources
      var id = res.getIdentifier(style, "style", activity.packageName)
      if (id == 0) id = res.getIdentifier(style.replace('.', '_'), "style", activity.packageName)
      if (id == 0) return@Function false
      activity.splashScreen.setSplashScreenTheme(id)
      true
    }
  }
}
