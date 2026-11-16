package expo.modules.docscanner

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

// Fits in 16 bits, as activity request codes must.
private const val REQUEST_SCAN = 0x5CA

// Receipts have small print, so keep them sharp but small enough to upload quickly:
// about 0.2–0.5 MB a page as JPEG.
private const val LONGEST_SIDE = 2000
private const val JPEG_QUALITY = 82

/**
 * Scans a receipt with Google's document scanner (ML Kit, run by Play services): it finds the
 * paper's edges, crops and straightens it, and lets the person retake or add pages. No camera
 * permission is needed. Each page comes back as a smaller JPEG in the app's cache.
 */
class DocScannerModule : Module() {
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("DocScanner")

    AsyncFunction("scan") { pageLimit: Int, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_NO_ACTIVITY", "Finlyt isn't in front, so the scanner can't open", null)
        return@AsyncFunction
      }
      if (pending != null) {
        promise.reject("ERR_BUSY", "The scanner is already open", null)
        return@AsyncFunction
      }
      val options = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(true)
        .setPageLimit(pageLimit.coerceIn(1, 4))
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build()
      pending = promise
      GmsDocumentScanning.getClient(options)
        .getStartScanIntent(activity)
        .addOnSuccessListener { sender ->
          try {
            @Suppress("DEPRECATION")
            activity.startIntentSenderForResult(sender, REQUEST_SCAN, null, 0, 0, 0)
          } catch (e: Exception) {
            pending = null
            promise.reject("ERR_SCAN_START", e.message ?: "The scanner didn't open", e)
          }
        }
        .addOnFailureListener { e ->
          pending = null
          promise.reject(
            "ERR_SCANNER_UNAVAILABLE",
            e.message ?: "The scanner isn't available on this phone",
            e,
          )
        }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_SCAN) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      if (payload.resultCode != Activity.RESULT_OK) {
        promise.resolve(null) // closed without scanning
        return@OnActivityResult
      }
      val pages = GmsDocumentScanningResult.fromActivityResultIntent(payload.data)?.pages.orEmpty()
      val context = appContext.reactContext
      if (pages.isEmpty() || context == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      // Decoding and re-encoding a few photos takes a moment: not on the main thread.
      Thread {
        try {
          val stamp = System.currentTimeMillis()
          val uris = pages.mapIndexed { i, page -> shrink(context, page.imageUri, "receipt-$stamp-$i.jpg") }
          promise.resolve(mapOf("pages" to uris))
        } catch (e: Exception) {
          promise.reject("ERR_SCAN_READ", e.message ?: "Couldn't read the scan", e)
        }
      }.start()
    }
  }

  private fun shrink(context: Context, source: Uri, name: String): String {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(source)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = max(bounds.outWidth, bounds.outHeight)
    var sample = 1
    while (longest / (sample * 2) >= LONGEST_SIDE) sample *= 2
    val decoded = resolver.openInputStream(source)?.use {
      BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: throw IllegalStateException("Couldn't open the scanned page")
    val scale = LONGEST_SIDE.toFloat() / max(decoded.width, decoded.height)
    val bitmap = if (scale < 1f) {
      Bitmap.createScaledBitmap(decoded, (decoded.width * scale).roundToInt(), (decoded.height * scale).roundToInt(), true)
    } else {
      decoded
    }
    val dir = File(context.cacheDir, "receipts").apply { mkdirs() }
    // Old scans are only needed until they're read; keep the folder from growing.
    dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 24 * 60 * 60 * 1000 }?.forEach { it.delete() }
    val file = File(dir, name)
    FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
    if (bitmap !== decoded) bitmap.recycle()
    decoded.recycle()
    return Uri.fromFile(file).toString()
  }
}
