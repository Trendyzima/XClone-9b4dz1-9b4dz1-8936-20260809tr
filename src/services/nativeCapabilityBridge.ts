type NativeCapabilityResponse = {
  status: number;
  ok: boolean;
  data?: string;
  code?: string;
};

type NativeCapabilityPlugin = {
  invokeCapability(options: {
    baseUrl: string;
    publishableKey: string;
    accessToken?: string | null;
    capability: string;
    input: Record<string, unknown>;
  }): Promise<NativeCapabilityResponse>;
};

function getNativePlugin(): NativeCapabilityPlugin | null {
  if (typeof window === "undefined") return null;
  const capacitor = (window as typeof window & {
    Capacitor?: { Plugins?: { TestagramNative?: NativeCapabilityPlugin } };
  }).Capacitor;
  return capacitor?.Plugins?.TestagramNative ?? null;
}

export function isTestagramNativeAndroidAvailable(): boolean {
  return Boolean(getNativePlugin());
}

export async function invokeNativeCapability<T>(
  options: {
    baseUrl: string;
    publishableKey: string;
    accessToken?: string | null;
    capability: string;
    input: Record<string, unknown>;
  }
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const plugin = getNativePlugin();
  if (!plugin) return { ok: false, status: 0, message: "Native bridge unavailable" };

  try {
    const response = await plugin.invokeCapability(options);
    const raw = response.data ?? "";
    const parsed = raw ? (JSON.parse(raw) as T) : ({} as T);
    if (response.ok) return { ok: true, data: parsed };
    return {
      ok: false,
      status: response.status,
      message: typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as { message?: unknown }).message ?? "Capability request failed")
        : raw || "Capability request failed",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : "Native capability request failed",
    };
  }
}
