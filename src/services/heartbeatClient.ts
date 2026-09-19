import { supabase } from "@/lib/supabase";

const HEARTBEAT_URL = "https://heartbeat.testagram.site";
const HEARTBEAT_INTERVAL_MS = 60_000;

let timer: number | undefined;
let running = false;

export function startTestagramHeartbeat(clientVersion = "web-v1"): () => void {
  if (running || typeof window === "undefined") return () => undefined;
  running = true;

  const send = async () => {
    if (document.visibilityState !== "visible") return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    await fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Client-Version": clientVersion,
      },
      body: "{}",
      keepalive: true,
    }).catch(() => undefined);
  };

  void send();
  timer = window.setInterval(() => void send(), HEARTBEAT_INTERVAL_MS);

  const onVisibility = () => {
    if (document.visibilityState === "visible") void send();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    if (timer !== undefined) window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    running = false;
  };
}
