package site.testagram.android.core

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

data class CapabilityResult<T>(val data: T?, val code: String? = null, val message: String? = null)

class CapabilityClient(
    private val baseUrl: String,
    private val publishableKey: String,
    private val http: OkHttpClient = OkHttpClient()
) {
    fun invoke(capability: String, input: JSONObject, accessToken: String?): CapabilityResult<JSONObject> {
        val body = JSONObject()
            .put("p_capability", capability)
            .put("p_input", input)
            .toString()
            .toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url("$baseUrl/rest/v1/rpc/capability_dispatch_v2")
            .post(body)
            .header("apikey", publishableKey)
            .apply { if (!accessToken.isNullOrBlank()) header("Authorization", "Bearer $accessToken") }
            .build()

        return try {
            http.newCall(request).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                val json = if (raw.isNotBlank()) runCatching { JSONObject(raw) }.getOrNull() else null
                if (response.isSuccessful) CapabilityResult(json)
                else {
                    val message = json?.optString("message")?.takeIf { it.isNotBlank() } ?: raw
                    CapabilityResult(null, "CAPABILITY_REQUEST_FAILED", message)
                }
            }
        } catch (e: Exception) {
            CapabilityResult(null, "NETWORK_ERROR", e.message ?: "Network request failed")
        }
    }
}
