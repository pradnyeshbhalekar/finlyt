package expo.modules.smsreader

import android.Manifest
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsPermissionException : CodedException("READ_SMS permission has not been granted")

/**
 * Reads the SMS inbox for Finlyt. Only messages newer than a cursor are returned, oldest first;
 * the app filters them down to bank messages before anything leaves the phone.
 */
class SmsReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    Function("hasPermission") {
      val context = appContext.reactContext ?: return@Function false
      ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) ==
        PackageManager.PERMISSION_GRANTED
    }

    AsyncFunction("readInbox") { sinceMillis: Double, limit: Int ->
      val context = appContext.reactContext ?: throw SmsPermissionException()
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) !=
        PackageManager.PERMISSION_GRANTED
      ) {
        throw SmsPermissionException()
      }
      val messages = mutableListOf<Map<String, Any>>()
      val projection = arrayOf(
        Telephony.Sms._ID,
        Telephony.Sms.ADDRESS,
        Telephony.Sms.BODY,
        Telephony.Sms.DATE,
      )
      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        projection,
        "${Telephony.Sms.DATE} > ?",
        arrayOf(sinceMillis.toLong().toString()),
        "${Telephony.Sms.DATE} ASC",
      )?.use { cursor ->
        val id = cursor.getColumnIndexOrThrow(Telephony.Sms._ID)
        val address = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
        val body = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
        val date = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
        while (cursor.moveToNext() && messages.size < limit) {
          messages.add(
            mapOf(
              "id" to (cursor.getString(id) ?: ""),
              "sender" to (cursor.getString(address) ?: ""),
              "body" to (cursor.getString(body) ?: ""),
              "date" to cursor.getLong(date).toDouble(),
            )
          )
        }
      }
      messages
    }
  }
}
