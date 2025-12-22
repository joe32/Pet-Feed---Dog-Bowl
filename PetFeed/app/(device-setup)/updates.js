import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useState, useRef } from "react";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { useLocalSearchParams } from "expo-router";

// const DEV_FAKE_UPDATE = true; // TEMP: remove later
// const DEV_FAKE_VERSION = "1.2.2"; // TEMP: fake newer version

const DEV_FORCE_UPDATE = false; // set true to force fake update UI

const POLL_INTERVAL = 1500;

async function fetchWithTimeout(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function tryJson(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await res.json();
  // Some ESP handlers may not set content-type correctly
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export default function UpdatesScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  const { host } = useLocalSearchParams();
  const baseUrl = host ? `http://${host}.local` : null;

  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const pollRef = useRef(null);
  const updateStartedAtRef = useRef(null);
  const sawNonIdleRef = useRef(false);

  const [currentVersion, setCurrentVersion] = useState(null);
  const [scheduledUpdate, setScheduledUpdate] = useState(null); 
  // { scheduled: boolean, time: string, latest: string }
  async function fetchUpdateSchedule() {
    if (!baseUrl) return;
    try {
      console.log("[updates] GET /update-schedule", `${baseUrl}/update-schedule`);
      const res = await fetchWithTimeout(`${baseUrl}/update-schedule`, {}, 3000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await tryJson(res);

      if (typeof json === "object" && json) {
        setScheduledUpdate({
          scheduled: !!json.scheduled,
          time: typeof json.time === "string" ? json.time : "",
          latest: typeof json.latest === "string" ? json.latest : "",
        });
      } else {
        setScheduledUpdate(null);
      }
    } catch (e) {
      console.log("[updates] fetch update schedule failed", String(e));
      setScheduledUpdate(null);
    }
  }

  const [updateStatus, setUpdateStatus] = useState(null); // { phase, downloadedMb, totalMb }

  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [preferredTime, setPreferredTime] = useState(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState(null);

  const enabledDirty = autoUpdateEnabled !== (lastSavedTime === "__enabled:false__" ? false : true);
  const timeDirty = preferredTime !== (lastSavedTime === "__enabled:false__" ? null : lastSavedTime);
  const prefsDirty = enabledDirty || timeDirty;
  const canSavePrefs =
    prefsDirty &&
    !savingPrefs &&
    // If enabling auto updates, a time is required
    (!autoUpdateEnabled || !!preferredTime);

  async function fetchVersion() {
    if (!baseUrl) return;
    try {
      console.log("[updates] GET /version", `${baseUrl}/version`);
      const res = await fetchWithTimeout(`${baseUrl}/version`, {}, 2500);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await tryJson(res);
      const v = typeof data?.version === "string" ? data.version : null;
      setCurrentVersion(v);
    } catch (e) {
      console.log("[updates] /version failed", String(e));
      setCurrentVersion(null);
    }
  }


  async function startUpdate() {
    if (!baseUrl) return;

    try {
      console.log("[updates] POST /cancel-update");
      await fetchWithTimeout(`${baseUrl}/cancel-update`, { method: "POST" }, 3000);
      setScheduledUpdate(null);
    } catch (e) {
      console.log("[updates] cancel scheduled update failed (continuing)", String(e));
    }

    try {
      console.log("[updates] POST /update", `${baseUrl}/update`);

      // Enter updating mode immediately so the progress UI stays visible
      setUpdating(true);
      setChecking(false);

      updateStartedAtRef.current = Date.now();
      sawNonIdleRef.current = false;

      // Seed a visible state so the progress card renders instantly
      setUpdateStatus({
        phase: "starting",
        downloadedMb: 0,
        totalMb: 0,
        message: "Starting update…",
      });

      // Ensure only one poller exists
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      // Start polling immediately (OTA may begin before /update responds)
      pollRef.current = setInterval(pollUpdateStatus, POLL_INTERVAL);

      // Fire the update request
      const res = await fetchWithTimeout(
        `${baseUrl}/update`,
        { method: "POST" },
        8000
      );

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      console.log("[updates] /update failed", String(e));
      // Stop polling + exit updating UI
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setUpdating(false);
      setUpdateStatus(null);
    }
  }

  async function probeUpdateStatusOnce() {
    if (!baseUrl) return;

    try {
      console.log("[updates] PROBE /update-status", `${baseUrl}/update-status`);
      const res = await fetchWithTimeout(`${baseUrl}/update-status`, {}, 3000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await tryJson(res);

      const phase =
        typeof json?.phase === "string"
          ? json.phase
          : typeof json === "string"
          ? json
          : "idle";

      // If ESP is idle, do nothing
      if (phase === "idle") {
        return;
      }

      // ESP is actively updating → enter updating UI and start polling
      console.log("[updates] detected active OTA phase:", phase);

      setUpdating(true);
      setChecking(false);

      updateStartedAtRef.current = Date.now();
      sawNonIdleRef.current = true;

      setUpdateStatus({
        ...(typeof json === "object" && json ? json : {}),
        phase,
        downloadedMb: Number(json?.downloadedMb || 0),
        totalMb: Number(json?.totalMb || 0),
        message: json?.message,
      });

      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      pollRef.current = setInterval(pollUpdateStatus, POLL_INTERVAL);
    } catch (e) {
      console.log("[updates] probe update-status failed", String(e));
    }
  }

  async function pollUpdateStatus() {
    if (!baseUrl) return;

    try {
      console.log("[updates] GET /update-status", `${baseUrl}/update-status`);
      const res = await fetchWithTimeout(`${baseUrl}/update-status`, {}, 3000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await tryJson(res);

      // Normalize a few shapes coming back from the ESP
      const phase = typeof json?.phase === "string" ? json.phase : (typeof json === "string" ? json : null);
      const downloadedMb = typeof json?.downloadedMb === "number" ? json.downloadedMb : (typeof json?.downloadedMb === "string" ? Number(json.downloadedMb) : undefined);
      const totalMb = typeof json?.totalMb === "number" ? json.totalMb : (typeof json?.totalMb === "string" ? Number(json.totalMb) : undefined);
      const message = typeof json?.message === "string" ? json.message : undefined;

      const normalized = {
        ...(typeof json === "object" && json ? json : {}),
        phase: phase || "unknown",
        downloadedMb: Number.isFinite(downloadedMb) ? downloadedMb : 0,
        totalMb: Number.isFinite(totalMb) ? totalMb : 0,
        message,
      };

      // If the ESP reports anything other than idle, remember it so we don't treat a later idle as "finished"
      if (normalized.phase && normalized.phase !== "idle") {
        sawNonIdleRef.current = true;
      }

      // IMPORTANT: Do not stop polling just because phase is idle.
      // Some builds report idle while preparing, or briefly between phases.
      if (normalized.phase === "idle" && updating) {
        const startedAt = updateStartedAtRef.current || Date.now();
        const elapsedMs = Date.now() - startedAt;

        // If we haven't seen progress yet, keep the UI visible as "Starting…"
        if (!sawNonIdleRef.current && elapsedMs < 60000) {
          setUpdateStatus({
            phase: "starting",
            downloadedMb: 0,
            totalMb: 0,
            message: "Preparing update…",
          });
          return;
        }

        // If we DID see non-idle phases and now it's idle, treat that as complete.
        if (sawNonIdleRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setUpdating(false);
          setUpdateStatus(null);
          await fullRefresh();
          return;
        }

        // If it's been a long time and still idle, show an error-like state but keep UI visible.
        if (elapsedMs >= 60000) {
          setUpdateStatus({
            phase: "error",
            downloadedMb: 0,
            totalMb: 0,
            message: "Update did not start. Try again.",
          });
          return;
        }
      }

      setUpdateStatus(normalized);

      // Stop polling once update is fully complete
      if (normalized.phase === "done") {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setUpdating(false);
        setUpdateStatus(null);
        await fullRefresh();
        return;
      }

      // If the ESP reports rebooting, keep UI visible and retry refresh after a delay
      if (normalized.phase === "rebooting") {
        clearInterval(pollRef.current);
        pollRef.current = null;

        setTimeout(async () => {
          setUpdating(false);
          setUpdateStatus(null);
          await fullRefresh();
        }, 30000);
      }

      // If the ESP reports error, stop polling but keep a visible state for the user
      if (normalized.phase === "error") {
        clearInterval(pollRef.current);
        pollRef.current = null;
        // keep updateStatus visible; just exit updating mode so user can retry
        setUpdating(false);
      }
    } catch (e) {
      console.log("[updates] poll failed", String(e));
      // Keep the UI visible while polling fails (device may reboot / Wi-Fi flaps)
      if (updating) {
        setUpdateStatus((prev) =>
          prev && typeof prev === "object"
            ? { ...prev, message: prev.message || "Waiting for device…" }
            : { phase: "starting", downloadedMb: 0, totalMb: 0, message: "Waiting for device…" }
        );
      }
    }
  }

  async function fetchAutoUpdatePrefs() {
    if (!baseUrl) return;
    try {
      console.log("[updates] GET /update-prefs", `${baseUrl}/update-prefs`);
      let res = await fetchWithTimeout(`${baseUrl}/update-prefs`, {}, 3000);
      if (!res.ok) {
        console.log("[updates] /update-prefs failed, trying /update-preferences");
        res = await fetchWithTimeout(`${baseUrl}/update-preferences`, {}, 3000);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await tryJson(res);

      const enabled = !!json?.enabled;
      const time = typeof json?.time === "string" ? json.time : null; // "HH:MM" or null

      setAutoUpdateEnabled(enabled);
      setPreferredTime(time);

      // We pack the enabled baseline into lastSavedTime so we can detect enabled changes without adding new state.
      // If enabled is false, store a sentinel.
      setLastSavedTime(enabled ? time : "__enabled:false__");
    } catch (e) {
      console.log("[updates] prefs fetch failed", String(e));
    }
  }

  async function saveAutoUpdatePrefs() {
    if (!baseUrl) return;
    setSavingPrefs(true);
    try {
      const body = JSON.stringify({
        enabled: autoUpdateEnabled,
        time: autoUpdateEnabled ? preferredTime : null,
      });

      console.log("[updates] POST /update-prefs", body);
      let res = await fetchWithTimeout(`${baseUrl}/update-prefs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }, 5000);

      if (!res.ok) {
        console.log("[updates] /update-prefs failed, trying /update-preferences");
        res = await fetchWithTimeout(`${baseUrl}/update-preferences`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }, 5000);
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Update baseline after save
      setLastSavedTime(autoUpdateEnabled ? preferredTime : "__enabled:false__");
    } catch (e) {
      console.log("[updates] save prefs failed", String(e));
    } finally {
      setSavingPrefs(false);
    }
  }

  async function fullRefresh() {
    if (!baseUrl) return;
    setRefreshing(true);
    await fetchVersion();
    await fetchAutoUpdatePrefs();
    await fetchUpdateSchedule();
    setRefreshing(false);
  }

  useEffect(() => {
    if (!baseUrl) return;

    (async () => {
      await fullRefresh();
      await probeUpdateStatusOnce();
    })();
  }, [baseUrl]);

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);


  const onRefresh = useCallback(async () => {
    await fullRefresh();
    await probeUpdateStatusOnce();
  }, [baseUrl]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={[styles.title, { color: colors.text }]}>Firmware Update</Text>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>CURRENT FIRMWARE</Text>
          <Text style={[styles.value, { color: colors.text }]}>
            {currentVersion ? `v${currentVersion}` : "—"}
          </Text>
        </View>

        {scheduledUpdate?.scheduled && (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.tint,
              },
            ]}
          >
            <Text style={[styles.updateTitle, { color: colors.text }]}>Update scheduled</Text>

            <Text style={{ color: colors.textSecondary }}>
              {scheduledUpdate?.latest
                ? `Version v${scheduledUpdate.latest} is scheduled to install.`
                : "An update is scheduled to install."}
            </Text>

            <Text style={{ color: colors.text, fontWeight: "700", marginTop: 8 }}>
              {scheduledUpdate?.time ? `Scheduled for ${scheduledUpdate.time}` : "Scheduled time unavailable"}
            </Text>
          </View>
        )}


        {updating && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            {!updateStatus && (
              <View>
                <Text style={[styles.updateTitle, { color: colors.text }]}>Updating</Text>
                <Text style={{ color: colors.textSecondary }}>Waiting for device status…</Text>
                <ActivityIndicator style={{ marginTop: 10 }} />
              </View>
            )}

            {updateStatus?.phase === "downloading" && (
              <View>
                <Text style={[styles.updateTitle, { color: colors.text }]}>Downloading</Text>
                <Text style={{ color: colors.textSecondary }}>
                  {Number(updateStatus.downloadedMb || 0).toFixed(2)}/{Number(updateStatus.totalMb || 0).toFixed(2)} MB
                </Text>
                <View style={styles.progressBarBackground}>
                  {typeof updateStatus.downloadedMb === "number" &&
                   typeof updateStatus.totalMb === "number" &&
                   updateStatus.totalMb > 0 && (
                     <View
                       style={[
                         styles.progressBarFill,
                         {
                           width: `${Math.min(
                             100,
                             (updateStatus.downloadedMb / updateStatus.totalMb) * 100
                           )}%`,
                         },
                       ]}
                     />
                  )}
                </View>
              </View>
            )}

            {updateStatus?.phase === "starting" && (
              <View>
                <Text style={[styles.updateTitle, { color: colors.text }]}>Preparing</Text>
                <Text style={{ color: colors.textSecondary }}>
                  {updateStatus.message || "Preparing update…"}
                </Text>
                <ActivityIndicator style={{ marginTop: 10 }} />
              </View>
            )}

            {updateStatus?.phase === "error" && (
              <View>
                <Text style={[styles.updateTitle, { color: colors.text }]}>Update failed</Text>
                <Text style={{ color: colors.textSecondary }}>
                  {updateStatus.message || "Something went wrong."}
                </Text>
              </View>
            )}

            {updateStatus?.phase === "installing" && (
              <View>
                <Text style={[styles.updateTitle, { color: colors.text }]}>Installing</Text>
                <ActivityIndicator />
              </View>
            )}

            {updateStatus?.phase === "rebooting" && (
              <View>
                <Text style={[styles.updateTitle, { color: colors.text }]}>Rebooting</Text>
                <Text style={{ color: colors.textSecondary }}>
                  This may take up to 30 seconds
                </Text>
                <ActivityIndicator />
              </View>
            )}
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.updateTitle, { color: colors.text }]}>
            Automatic Updates
          </Text>

          <TouchableOpacity
            onPress={() => {
              setAutoUpdateEnabled((v) => {
                const next = !v;
                if (!next) setShowTimePicker(false);
                return next;
              });
            }}
            style={{ marginTop: 12, flexDirection: "row", alignItems: "center" }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: colors.text,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 10,
                backgroundColor: autoUpdateEnabled ? "#34C759" : "transparent",
              }}
            >
              {autoUpdateEnabled && (
                <Text style={{ color: "#fff", fontWeight: "800" }}>✓</Text>
              )}
            </View>
            <Text style={{ color: colors.text }}>Enable automatic updates</Text>
          </TouchableOpacity>

          {autoUpdateEnabled && (
            <TouchableOpacity
              onPress={() => setShowTimePicker((v) => !v)}
              style={{ marginTop: 12 }}
              activeOpacity={0.8}
            >
              <Text style={{ color: colors.tint, fontWeight: "600" }}>
                {preferredTime
                  ? `Preferred update time: ${preferredTime}  (tap to change)`
                  : "Tap here to pick your preferred update time"}
              </Text>
            </TouchableOpacity>
          )}

          {showTimePicker && (
            <View style={{ marginTop: 12 }}>
              <DateTimePicker
                value={
                  preferredTime
                    ? (() => {
                        const [h, m] = preferredTime.split(":").map(Number);
                        const d = new Date();
                        d.setHours(h, m, 0, 0);
                        return d;
                      })()
                    : new Date()
                }
                mode="time"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(event, selectedDate) => {
                  // Android fires once; iOS spinner fires continuously.
                  // Only auto-close on Android.
                  if (Platform.OS !== "ios") {
                    setShowTimePicker(false);
                  }
                  if (!selectedDate) return;
                  const hours = String(selectedDate.getHours()).padStart(2, "0");
                  const minutes = String(selectedDate.getMinutes()).padStart(2, "0");
                  setPreferredTime(`${hours}:${minutes}`);
                }}
              />

              {Platform.OS === "ios" && (
                <TouchableOpacity
                  onPress={() => setShowTimePicker(false)}
                  style={{ alignSelf: "flex-end", paddingVertical: 8, paddingHorizontal: 6 }}
                >
                  <Text style={{ color: colors.tint, fontWeight: "600" }}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.primaryButton,
              {
                marginTop: 16,
                opacity: canSavePrefs ? 1 : 0.5,
              },
            ]}
            disabled={!canSavePrefs}
            onPress={saveAutoUpdatePrefs}
          >
            <Text style={styles.primaryButtonText}>Save</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: "600",
    marginBottom: 24,
  },
  card: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
  },
  label: {
    fontSize: 12,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  value: {
    fontSize: 20,
    fontWeight: "600",
  },
  updateTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  primaryButton: {
    marginTop: 16,
    backgroundColor: "#34C759",
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#999",
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 15,
    color: "#999",
  },
  linkButton: {
    alignItems: "center",
  },
  progressBarBackground: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#e5e5ea",
    marginTop: 12,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 8,
    backgroundColor: "#34C759",
  },
});