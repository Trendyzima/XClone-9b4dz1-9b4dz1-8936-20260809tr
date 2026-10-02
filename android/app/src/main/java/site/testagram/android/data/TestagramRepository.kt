package site.testagram.android.data

import org.json.JSONObject
import site.testagram.android.core.CapabilityClient
import site.testagram.android.core.CapabilityResult

class TestagramRepository(private val client: CapabilityClient) {
    fun invoke(capability: String, input: JSONObject = JSONObject(), accessToken: String? = null): CapabilityResult<JSONObject> =
        client.invoke(capability, input, accessToken)
}
