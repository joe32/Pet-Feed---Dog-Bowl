import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";

// const DEV_FAKE_UPDATE = true; // TEMP: remove later
// const DEV_FAKE_VERSION = "1.2.2"; // TEMP: fake newer version

const POLL_INTERVAL = 1500;

export default function UpdatesScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);

  const [currentVersion, setCurrentVersion] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null); // { status: 'up-to-date' | 'available', version }

  const [updateStatus, setUpdateStatus] = useState(null); // { phase, downloadedMb, totalMb }

  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [preferredTime, setPreferredTime] = useState(null);
  const [savingPrefs, setSavingPrefs] = useState(false);

  async function fetchVersion() {
    const res = await fetch("/version");
    const text = await res.text();
    setCurrentVersion(text);
  }

  async function checkForUpdates() {
    setChecking(true);
    try {
      if (DEV_FAKE_UPDATE) {
        setUpdateInfo({ status: "available", version: DEV_FAKE_VERSION });
        return;
      }

      const res = await fetch("/check-update");
      const text = await res.text();

      if (text.toLowerCase().includes("up to date")) {
        setUpdateInfo({ status: "up-to-date" });
      } else {
        setUpdateInfo({ status: "available", version: text });
      }
    } catch (e) {
      setUpdateInfo(null);
    } finally {
      setChecking(false);
    }
  }

  async function startUpdate() {
    setUpdating(true);
    setUpdateStatus({ phase: "starting" });
    await fetch("/update");
    // Start polling for update status after initiating update
    pollUpdateStatus();
  }

  async function pollUpdateStatus() {
    try {
      const res = await fetch("/update-status");
      const json = await res.json();
      setUpdateStatus(json);

      if (json.phase === "rebooting") {
        // wait for device to come back, then refresh everything
        setTimeout(async () => {
          setUpdating(false);
          setUpdateStatus(null);
          await fullRefresh();
        }, 30000);
      }
    } catch {}
  }

  async function fetchAutoUpdatePrefs() {
    try {
      const res = await fetch("/update-preferences");
      const json = await res.json();
      setAutoUpdateEnabled(!!json.enabled);
      setPreferredTime(json.time ?? null);
    } catch {}
  }

  async function saveAutoUpdatePrefs() {
    setSavingPrefs(true);
    await fetch("/update-preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: autoUpdateEnabled,
        time: preferredTime,
      }),
    });
    setSavingPrefs(false);
  }

  async function fullRefresh() {
    setRefreshing(true);
    await fetchVersion();
    await checkForUpdates();
    await fetchAutoUpdatePrefs();
    setRefreshing(false);
  }

  useEffect(() => {
    fullRefresh();
  }, []);

  useEffect(() => {
    if (!updating) return;
    const id = setInterval(pollUpdateStatus, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [updating]);

  const onRefresh = useCallback(async () => {
    await fullRefresh();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={[styles.title, { color: colors.text }]}>Software Update</Text>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>CURRENT FIRMWARE</Text>
          <Text style={[styles.value, { color: colors.text }]}>
            {currentVersion ?? "—"}
          </Text>
        </View>

        {!updating && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>            
            {checking ? (
              <ActivityIndicator />
            ) : updateInfo?.status === "up-to-date" ? (
              <Text style={{ color: colors.text }}>Already up to date</Text>
            ) : updateInfo?.status === "available" ? (
              <View>
                <Text style={[styles.updateTitle, { color: colors.text }]}>New Update Available</Text>
                <Text style={{ color: colors.textSecondary }}>
                  Version {updateInfo.version}
                </Text>

                <TouchableOpacity style={styles.primaryButton} onPress={startUpdate}>
                  <Text style={styles.primaryButtonText}>Update Now</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={checkForUpdates} style={styles.linkButton}>
                <Text style={{ color: colors.tint }}>Check for updates</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {updating && updateStatus && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>            
            {updateStatus.phase === "downloading" && (
              <View>
                <Text style={[styles.updateTitle, { color: colors.text }]}>Downloading</Text>
                <Text style={{ color: colors.textSecondary }}>
                  {updateStatus.downloadedMb}/{updateStatus.totalMb} MB
                </Text>
                <View style={styles.progressBarBackground}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${(updateStatus.downloadedMb / updateStatus.totalMb) * 100}%` },
                    ]}
                  />
                </View>
              </View>
            )}

            {updateStatus.phase === "installing" && (
              <View>
                <Text style={[styles.updateTitle, { color: colors.text }]}>Installing</Text>
                <ActivityIndicator />
              </View>
            )}

            {updateStatus.phase === "rebooting" && (
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
            onPress={() => setAutoUpdateEnabled(v => !v)}
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
              onPress={() => setPreferredTime && setPreferredTime(true)}
              style={{ marginTop: 12 }}
            >
              <Text style={{ color: colors.tint }}>
                Preferred update time: {preferredTime ?? "Not set"}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, { marginTop: 16, opacity: savingPrefs ? 0.5 : 1 }]}
            disabled={savingPrefs}
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