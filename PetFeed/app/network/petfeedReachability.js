// app/network/petfeedReachability.js
import { Platform } from "react-native";

/**
 * Ping a device's local HTTP endpoint to see if it's online.
 * ESP will expose: GET http://<ip>/ping  -> 200 OK (any body)
 */
export async function pingDevice(ip, timeoutMs = 1500) {
  if (!ip) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `http://${ip}/ping`;
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      // iOS sometimes caches aggressively; this helps avoid stale "online"
      headers: { "Cache-Control": "no-cache" },
    });
    return res.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Poll a single selected device and call onStatusChange(online:boolean).
 * Returns a stop() function.
 */
export function startOnlinePolling({ ip, intervalMs = 3000, onStatusChange }) {
  let cancelled = false;
  let last = null;

  async function tick() {
    if (cancelled) return;

    const online = await pingDevice(ip);
    if (last === null || online !== last) {
      last = online;
      onStatusChange?.(online);
    }

    if (!cancelled) setTimeout(tick, intervalMs);
  }

  tick();

  return () => {
    cancelled = true;
  };
}