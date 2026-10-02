package com.xclone.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "TestagramNative")
public class TestagramNativePlugin extends Plugin {

    @PluginMethod
    public void invokeCapability(final PluginCall call) {
        final String baseUrl = call.getString("baseUrl");
        final String publishableKey = call.getString("publishableKey");
        final String accessToken = call.getString("accessToken");
        final String capability = call.getString("capability");
        final JSObject input = call.getObject("input", new JSObject());

        if (baseUrl == null || publishableKey == null || capability == null) {
            call.reject("Missing native capability configuration", "INVALID_ARGUMENT");
            return;
        }

        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(baseUrl.replaceAll("/+$", "") + "/rest/v1/rpc/capability_dispatch_v2");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("apikey", publishableKey);
                if (accessToken != null && !accessToken.isBlank()) {
                    connection.setRequestProperty("Authorization", "Bearer " + accessToken);
                }

                JSONObject payload = new JSONObject();
                payload.put("p_capability", capability);
                payload.put("p_input", new JSONObject(input.toString()));

                byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }

                int status = connection.getResponseCode();
                BufferedReader reader = new BufferedReader(new InputStreamReader(
                    status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream(),
                    StandardCharsets.UTF_8
                ));
                StringBuilder raw = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) raw.append(line);

                JSObject result = new JSObject();
                result.put("status", status);
                result.put("ok", status >= 200 && status < 300);
                result.put("data", raw.toString());

                if (status >= 200 && status < 300) {
                    call.resolve(result);
                } else {
                    result.put("code", "CAPABILITY_REQUEST_FAILED");
                    call.reject(raw.toString(), "CAPABILITY_REQUEST_FAILED", result);
                }
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Native capability request failed" : e.getMessage(), "NETWORK_ERROR");
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }
}
