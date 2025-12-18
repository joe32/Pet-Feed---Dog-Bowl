import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, ScrollView, RefreshControl } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { writeCommand, subscribeToNotifications } from "../ble/bleManager";

const STORAGE_KEY = "PETFEED_DEVICES";
const ACTIVE_DEVICE_KEY = "PETFEED_ACTIVE_DEVICE";

export default function HomeScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  const [devices, setDevices] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lidState, setLidState] = useState(null);
  const [hasScheduledFeed, setHasScheduledFeed] = useState(false);
  const [scheduledLabel, setScheduledLabel] = useState(null);

  // const [showPicker, setShowPicker] = useState(false);
  const [scheduledTime, setScheduledTime] = useState(new Date());

  async function scheduleFeed() {
    if (!currentDevice || !currentDevice.online) return;

    const hours = scheduledTime.getHours().toString().padStart(2, "0");
    const minutes = scheduledTime.getMinutes().toString().padStart(2, "0");
    const timeStr = `${hours}:${minutes}`;

    // Optimistically update UI (works even in Expo Go)
    setHasScheduledFeed(true);
    setScheduledLabel(
      scheduledTime.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    );

    try {
      await writeCommand(`SCHEDULE:${timeStr}`);
    } catch (e) {
      console.log("Failed to schedule feed", e);
    }
  }

  async function cancelSchedule() {
    if (!currentDevice || !currentDevice.online) return;

    // Optimistically update UI (works even in Expo Go)
    setHasScheduledFeed(false);
    setScheduledLabel(null);

    try {
      await writeCommand("CANCEL_SCHEDULE");
    } catch (e) {
      console.log("Failed to cancel schedule", e);
    }
  }

  async function pingDevice(hostname) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      await fetch(`http://${hostname}/ping`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return true;
    } catch {
      return false;
    }
  }

  const loadDevices = useCallback(async () => {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const activeId = await AsyncStorage.getItem(ACTIVE_DEVICE_KEY);

    const parsed = saved ? JSON.parse(saved) : [];
    // Do not assume online is true; keep as is or false
    setDevices(parsed);

    if (activeId && parsed.find(d => d.id === activeId)) {
      setCurrentId(activeId);
    } else {
      setCurrentId(null);
    }
  }, []);

  async function requestLidState() {
    if (!currentDevice || !currentDevice.online) return;

    try {
      await writeCommand("GETSTATE");
    } catch (e) {
      console.log("Failed to request lid state", e);
    }
  }

  async function requestScheduleStatus() {
    if (!currentDevice || !currentDevice.online) return;

    try {
      await writeCommand("GETSCHEDULE");
      // ESP will later respond with:
      // SCHEDULED:HH:MM  or  SCHEDULE:NONE
    } catch (e) {
      console.log("Failed to request schedule status", e);
    }
  }

  useFocusEffect(
    useCallback(() => {
      loadDevices();
      requestLidState();
      requestScheduleStatus();
    }, [loadDevices])
  );

  useEffect(() => {
    let interval;

    async function checkAllDevices() {
      if (devices.length === 0) return;

      const updatedDevices = await Promise.all(
        devices.map(async device => {
          if (!device.hostname) return device;
          const isOnline = await pingDevice(device.hostname);
          return { ...device, online: isOnline };
        })
      );

      setDevices(updatedDevices);

      // If current device is offline, update UI immediately
      const currentDeviceUpdated = updatedDevices.find(d => d.id === currentId);
      if (currentDeviceUpdated && currentDeviceUpdated.online === false) {
        setCurrentId(currentDeviceUpdated.id); // keep currentId but UI will read online false
      }
    }

    interval = setInterval(checkAllDevices, 5000);
    checkAllDevices();

    return () => clearInterval(interval);
  }, [devices, currentId]);

  useEffect(() => {
    let unsubscribe;

    async function subscribe() {
      unsubscribe = await subscribeToNotifications((value) => {
        if (value.startsWith("STATE:")) {
          const state = value.replace("STATE:", "");
          setLidState(state);
          return;
        }

        if (value.startsWith("SCHEDULED:")) {
          const time = value.replace("SCHEDULED:", "");
          setHasScheduledFeed(true);
          setScheduledLabel(time);
          return;
        }

        if (value === "SCHEDULE:NONE") {
          setHasScheduledFeed(false);
          setScheduledLabel(null);
          return;
        }
      });
    }

    subscribe();

    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!currentDevice || !currentDevice.online) return;

    const id = setInterval(() => {
      requestLidState();
      requestScheduleStatus();
    }, 10000);

    return () => clearInterval(id);
  }, [currentDevice?.id, currentDevice?.online]);

  async function switchDevice(device) {
    setCurrentId(device.id);
    await AsyncStorage.setItem(ACTIVE_DEVICE_KEY, device.id);
    setDropdownOpen(false);
    // Do not mark online here
  }

  const currentDevice = devices.find(d => d.id === currentId);

  async function sendCommand(command) {
    if (!currentDevice || !currentDevice.hostname) return;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`http://${currentDevice.hostname}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error("Non-200 response");
      }
    } catch (e) {
      console.log("Command failed", e);
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Force a full ping cycle
    if (devices.length > 0) {
      const updatedDevices = await Promise.all(
        devices.map(async device => {
          if (!device.hostname) return device;
          const isOnline = await pingDevice(device.hostname);
          return { ...device, online: isOnline };
        })
      );
      setDevices(updatedDevices);
    }
    await loadDevices();
    await requestLidState();
    await requestScheduleStatus();
    setRefreshing(false);
  }, [devices, loadDevices]);

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: colors.background,
      }}
    >
      {/* Header */}
      <View style={styles.header}>
        {/* Left: device selector */}
        <View style={styles.leftSlot}>
          {currentDevice ? (
            <TouchableOpacity
              onPress={() => setDropdownOpen(true)}
              style={styles.deviceRow}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: currentDevice.online ? "#3ddc84" : "#777" },
                ]}
              />
              <Text
                style={{ color: colors.textSecondary, fontSize: 14 }}
                numberOfLines={1}
              >
                {currentDevice.name} · {currentDevice.online ? "Online" : "Offline"}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
              No device
            </Text>
          )}
        </View>

        {/* Center: title (ABSOLUTE) */}
        <View style={styles.centerTitle}>
          <Text style={[styles.title, { color: colors.text }]}>Schedule</Text>
        </View>

        {/* Right spacer */}
        <View style={styles.rightSlot} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center" }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {currentDevice && (
          <View style={{ flexDirection: "column", alignItems: "center", marginBottom: 16 }}>
            {scheduledLabel && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                  Currently scheduled for {scheduledLabel}
                </Text>
              </View>
            )}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: colors.textSecondary, marginRight: 12 }}>
                Lid state: {lidState ? lidState.toLowerCase() : "unknown"}
              </Text>
              <TouchableOpacity
                onPress={() => sendCommand("OPEN")}
                disabled={
                  !currentDevice.online ||
                  (lidState === "CLOSED")
                }
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 8,
                  backgroundColor: "#34C759",
                  opacity:
                    !currentDevice.online || lidState === "CLOSED"
                      ? 0.4
                      : 1,
                  marginRight: 6,
                }}
              >
                <Text style={{ color: "#000", fontSize: 12, fontWeight: "600" }}>
                  Open
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => sendCommand("CLOSE")}
                disabled={
                  !currentDevice.online ||
                  (lidState === "OPEN")
                }
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: "#ff3b30",
                  opacity:
                    !currentDevice.online || lidState === "OPEN"
                      ? 0.4
                      : 1,
                }}
              >
                <Text style={{ color: "#ff3b30", fontSize: 12, fontWeight: "600" }}>
                  Close
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.scheduleCard}>
          <Text style={[styles.scheduleLabel, { color: colors.textSecondary }]}>
            SCHEDULE FEED
          </Text>

          <View style={styles.timePill}>
            <Text style={[styles.timeText, { color: colors.text }]}>
              {scheduledTime.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </View>
          <DateTimePicker
            value={scheduledTime}
            mode="time"
            display="spinner"
            onChange={(event, date) => {
              if (date) setScheduledTime(date);
            }}
          />

          <View style={styles.scheduleButtons}>
            <TouchableOpacity
              onPress={scheduleFeed}
              disabled={
                !currentDevice?.online ||
                hasScheduledFeed ||
                scheduledLabel !== null
              }
              style={[
                styles.primaryScheduleButton,
                {
                  opacity:
                    !currentDevice?.online ||
                    hasScheduledFeed ||
                    scheduledLabel !== null
                      ? 0.4
                      : 1,
                },
              ]}
            >
              <Text style={styles.primaryScheduleText}>Schedule Feed</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={cancelSchedule}
              disabled={!currentDevice?.online || !hasScheduledFeed}
              style={[
                styles.cancelScheduleButton,
                {
                  opacity:
                    !currentDevice?.online || !hasScheduledFeed ? 0.4 : 1,
                },
              ]}
            >
              <Text style={styles.cancelScheduleText}>Cancel Scheduled Feed</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>

      {/* Dropdown */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setDropdownOpen(false)}>
          <View style={[styles.dropdown, { backgroundColor: colors.card }]}>
            {devices.map(device => (
              <TouchableOpacity
                key={device.id}
                onPress={() => switchDevice(device)}
                style={styles.dropdownItem}
              >
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: device.online ? "#3ddc84" : "#777" },
                  ]}
                />
                <Text style={{ color: colors.text, flex: 1 }}>
                  {device.name}
                </Text>
                {device.id === currentId && (
                  <Text style={{ color: colors.tint, fontSize: 16 }}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: "600",
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-start",
    paddingTop: 90,
    paddingHorizontal: 24,
  },
  dropdown: {
    borderRadius: 14,
    paddingVertical: 8,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  leftSlot: {
    flex: 1,
    justifyContent: "center",
  },
  rightSlot: {
    flex: 1,
  },
  centerTitle: {
    position: "absolute",
    left: 0,
    right: 40,
    top: 8,
    alignItems: "flex-end",
  },
  centerControl: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scheduleCard: {
    width: "100%",
    maxWidth: 360,
    marginTop: 32,
    padding: 24,
    borderRadius: 28,
    backgroundColor: "#1c1c1e",
    alignItems: "center",
  },

  scheduleLabel: {
    fontSize: 12,
    letterSpacing: 1.2,
    fontWeight: "600",
    marginBottom: 16,
  },

  timePill: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 999,
    backgroundColor: "#2c2c2e",
    marginBottom: 24,
  },

  timeText: {
    fontSize: 28,
    fontWeight: "700",
  },

  scheduleButtons: {
    width: "100%",
    gap: 14,
  },

  primaryScheduleButton: {
    backgroundColor: "#34C759",
    paddingVertical: 16,
    borderRadius: 18,
    alignItems: "center",
  },

  primaryScheduleText: {
    color: "#000",
    fontSize: 17,
    fontWeight: "700",
  },

  cancelScheduleButton: {
    borderWidth: 2,
    borderColor: "#ff3b30",
    paddingVertical: 14,
    borderRadius: 18,
    alignItems: "center",
  },

  cancelScheduleText: {
    color: "#ff3b30",
    fontSize: 16,
    fontWeight: "600",
  },
});
