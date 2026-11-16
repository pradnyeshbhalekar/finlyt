package expo.modules.imeinset

import android.content.Context
import android.view.MotionEvent
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt

/**
 * The keyboard's height, as seen from inside a React Native Modal.
 *
 * A Modal is its own Android window. Android draws it edge to edge, so the window doesn't shrink
 * for the keyboard, and the app's other keyboard trackers (React Native's Keyboard events,
 * Reanimated's useAnimatedKeyboard) only watch the main window. So a sheet's text box ended up
 * under the keyboard. This invisible view sits in the sheet, reads its own window's insets and
 * reports the keyboard height in dp; the sheet lifts its content by that much.
 */
class ImeInsetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ImeInset")

    View(ImeInsetView::class) {
      Events("onInsets")
    }
  }
}

class ImeInsetView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onInsets by EventDispatcher()
  private var lastKeyboard = -1

  init {
    ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
      report(insets, 0)
      insets
    }
    // Android sends the keyboard's final insets as its animation starts; report them then, with
    // the animation's length, so the sheet moves in step with the keyboard.
    ViewCompat.setWindowInsetsAnimationCallback(
      this,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onStart(
          animation: WindowInsetsAnimationCompat,
          bounds: WindowInsetsAnimationCompat.BoundsCompat,
        ): WindowInsetsAnimationCompat.BoundsCompat {
          if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) {
            ViewCompat.getRootWindowInsets(this@ImeInsetView)?.let { report(it, animation.durationMillis) }
          }
          return bounds
        }

        override fun onProgress(
          insets: WindowInsetsCompat,
          runningAnimations: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat = insets
      },
    )
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    ViewCompat.getRootWindowInsets(this)?.let { report(it, 0) }
    ViewCompat.requestApplyInsets(this)
  }

  private fun report(insets: WindowInsetsCompat, durationMillis: Long) {
    val density = resources.displayMetrics.density
    val keyboard = if (insets.isVisible(WindowInsetsCompat.Type.ime())) {
      (insets.getInsets(WindowInsetsCompat.Type.ime()).bottom / density).roundToInt()
    } else {
      0
    }
    if (keyboard == lastKeyboard && durationMillis == 0L) return
    lastKeyboard = keyboard
    val navigation = (insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom / density).roundToInt()
    onInsets(mapOf("keyboard" to keyboard, "navigation" to navigation, "duration" to durationMillis.toInt()))
  }

  // Never takes touches; it's only there to read insets.
  override fun dispatchTouchEvent(event: MotionEvent?): Boolean = false
}
