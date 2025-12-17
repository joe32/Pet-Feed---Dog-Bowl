// app/network/petfeedReachability.js
import AsyncStorage from "@react-native-async-storage/async-storage";

const DEVICES_KEY = "PETFEED_DEVICES";

/**
 * Ping a device's local HTTP endpoint to see if it's online.
 * ESP exposes: GET http://<ip>/ping -> 200 OK
 */
export async function pingDevice(ip, timeoutMs = 1500) {
  if (!ip) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`http://${ip}/ping`, {
      method: "GET",
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache" },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Update a device's `online` flag in AsyncStorage.
 */
async function persistOnlineState(deviceId, online) {
  const raw = await AsyncStorage.getItem(DEVICES_KEY);
  if (!raw) return;

  const devices = JSON.parse(raw);
  const updated = devices.map(d =>
    d.id === deviceId ? { ...d, online } : d
  );

  await AsyncStorage.setItem(DEVICES_KEY, JSON.stringify(updated));
}

/**
 * Start polling a device for online/offline state.
 * This is the ONLY place online status should be determined.
 */
export function startOnlinePolling({
  deviceId,
  ip,
  intervalMs = 3000,
  onStatusChange,
}) {
  let cancelled = false;
  let last = null;

  async function tick() {
    if (cancelled) return;

    const online = await pingDevice(ip);

    if (last === null || online !== last) {
      last = online;
      await persistOnlineState(deviceId, online);
      onStatusChange?.(online);
    }

    if (!cancelled) {
      setTimeout(tick, intervalMs);
    }
  }

  tick();

  return () => {
    cancelled = true;
  };
}