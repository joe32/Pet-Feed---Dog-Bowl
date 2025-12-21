import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  RefreshControl,
  Linking,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";



const STORAGE_KEY = "PETFEED_DEVICES";
const ACTIVE_DEVICE_KEY = "PETFEED_ACTIVE_DEVICE";
const NOTIFICATION_ID_KEY = "PETFEED_SCHEDULE_NOTIFICATION_ID";

export default function HomeScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];
  // PREVIEW ONLY – remove later
  const PREVIEW_STATUS = false;

  const [devices, setDevices] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lidState, setLidState] = useState(null);
  const [hasScheduledFeed, setHasScheduledFeed] = useState(false);
  const [scheduledLabel, setScheduledLabel] = useState(null);

  const [showPicker, setShowPicker] = useState(false);
  const [scheduledTime, setScheduledTime] = useState(new Date());
  const androidTempTimeRef = useRef(null);

  const lastLidFetchRef = useRef(0);
  const lastScheduleFetchRef = useRef(0);

  // Memoised Android time picker to prevent re-render resets (ANDROID ONLY)
  const androidTimePicker = useMemo(() => {
    if (Platform.OS !== "android" || !showPicker) return null;

    return (
      <DateTimePicker
        value={androidTempTimeRef.current ?? scheduledTime}
        mode="time"
        display="spinner"
        is24Hour={false}
        onChange={(event, date) => {
          if (event.type === "dismissed") {
            setShowPicker(false);
            androidTempTimeRef.current = null;
            return;
          }

          if (event.type === "set" && date) {
            setShowPicker(false);
            androidTempTimeRef.current = null;
            setScheduledTime(new Date(date.getTime()));
          }
        }}
      />
    );
  }, [showPicker]);
  

  async function scheduleFeed() {
    if (!currentDevice || !currentDevice.online) return;

    const hours = scheduledTime.getHours().toString().padStart(2, "0");
    const minutes = scheduledTime.getMinutes().toString().padStart(2, "0");
    const timeStr = `${hours}:${minutes}`;

    try {
      await fetch(`http://${currentDevice.hostname}/SCHEDULE`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: timeStr }),
      });
      const notifyDate = new Date();
      notifyDate.setHours(scheduledTime.getHours());
      notifyDate.setMinutes(scheduledTime.getMinutes());
      notifyDate.setSeconds(0);

      // If time already passed today, schedule for tomorrow
      if (notifyDate <= new Date()) {
        notifyDate.setDate(notifyDate.getDate() + 1);
      }

      await fetchScheduleState(true);
      await fetchLidState(true);
    } catch (e) {
      console.log("Failed to schedule feed", e);
    }
  }

  async function cancelSchedule() {
    if (!currentDevice || !currentDevice.online) return;

    try {
      await fetch(`http://${currentDevice.hostname}/CANCEL_SCHEDULE`, {
        method: "POST",
      });
      await fetchScheduleState(true);
      await fetchLidState(true);
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

  async function fetchScheduleState(force = false) {
    if (!currentDevice || !currentDevice.hostname) return;

    const now = Date.now();
    if (!force && now - lastScheduleFetchRef.current < 20000) return;
    lastScheduleFetchRef.current = now;

    try {
      const res = await fetch(`http://${currentDevice.hostname}/GETSCHEDULE`);
      const data = await res.json();
      if (data.hasSchedule === true) {
        setHasScheduledFeed(true);
        if (data.hour !== undefined && data.minute !== undefined) {
          const hh = data.hour.toString().padStart(2, "0");
          const mm = data.minute.toString().padStart(2, "0");
          setScheduledLabel(`${hh}:${mm}`);
        } else {
          setScheduledLabel(null);
        }
      } else {
        setHasScheduledFeed(false);
        setScheduledLabel(null);
      }
    } catch (e) {
      console.log("Failed to fetch schedule state", e);
    }
  }

  // Lid state polling helper
  async function fetchLidState(force = false) {
    if (!currentDevice || !currentDevice.hostname) return;

    const now = Date.now();
    if (!force && now - lastLidFetchRef.current < 20000) return;
    lastLidFetchRef.current = now;

    try {
      const res = await fetch(`http://${currentDevice.hostname}/GETSTATE`);
      const data = await res.json();
      if (data.state === "OPEN" || data.state === "CLOSED") {
        setLidState(data.state);
      } else {
        setLidState(null);
      }
    } catch (e) {
      console.log("Failed to fetch lid state", e);
    }
  }

  const loadDevices = useCallback(async () => {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const activeId = await AsyncStorage.getItem(ACTIVE_DEVICE_KEY);

    const parsed = saved ? JSON.parse(saved) : [];
    // Do not assume online is true; keep as is or false
    setDevices(parsed);

    if (activeId && parsed.find((d) => d.id === activeId)) {
      setCurrentId(activeId);
    } else {
      setCurrentId(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDevices();
      fetchScheduleState();
      fetchLidState();
    }, [loadDevices])
  );

  useEffect(() => {
    let interval;

    async function checkAllDevices() {
      if (devices.length === 0) return;

      const updatedDevices = await Promise.all(
        devices.map(async (device) => {
          if (!device.hostname) return device;
          const isOnline = await pingDevice(device.hostname);
          if (device.online === isOnline) return device;
          return { ...device, online: isOnline };
        })
      );

      setDevices(updatedDevices);

      // If current device is offline, update UI immediately
      const currentDeviceUpdated = updatedDevices.find(
        (d) => d.id === currentId
      );
      if (currentDeviceUpdated && currentDeviceUpdated.online === false) {
        setCurrentId(currentDeviceUpdated.id); // keep currentId but UI will read online false
      }
      if (currentDeviceUpdated && currentDeviceUpdated.online === true) {
        fetchScheduleState();
        fetchLidState();
      }
    }

    interval = setInterval(checkAllDevices, 5000);
    checkAllDevices();

    return () => clearInterval(interval);
  }, [devices, currentId]);

  async function switchDevice(device) {
    setCurrentId(device.id);
    await AsyncStorage.setItem(ACTIVE_DEVICE_KEY, device.id);
    setDropdownOpen(false);
    // Do not mark online here
  }

  const currentDevice = devices.find((d) => d.id === currentId);

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
      await fetchLidState(true);
    } catch (e) {
      console.log("Command failed", e);
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Force a full ping cycle
    if (devices.length > 0) {
      const updatedDevices = await Promise.all(
        devices.map(async (device) => {
          if (!device.hostname) return device;
          const isOnline = await pingDevice(device.hostname);
          return { ...device, online: isOnline };
        })
      );
      setDevices(updatedDevices);
    }
    await loadDevices();
    await fetchScheduleState(true);
    await fetchLidState(true);
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
                  {
                    backgroundColor: currentDevice.online ? "#3ddc84" : "#777",
                  },
                ]}
              />
              <Text
                style={{ color: colors.textSecondary, fontSize: 16 }}
                numberOfLines={1}
              >
                {currentDevice.name} ·{" "}
                {currentDevice.online ? "Online" : "Offline"}
              </Text>
              <Text
                style={{
                  marginLeft: 6,
                  fontSize: 16,
                  marginBottom: 0,
                  color: colors.textSecondary,
                }}
              >
                ▾
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={{ color: colors.textSecondary, fontSize: 16 }}>
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
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "flex-start",
          alignItems: "center",
          marginTop: 20,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {(currentDevice || PREVIEW_STATUS) && (
          <View
            style={[
              styles.combinedStatusPill,
              scheme === "light" && styles.combinedStatusPillLight,
            ]}
          >
            <View style={styles.lidStatusInline}>
              <View
                style={[
                  styles.lidDot,
                  {
                    backgroundColor:
                      lidState === "OPEN"
                        ? "#34C759"
                        : lidState === "CLOSED"
                        ? "#ff3b30"
                        : "#8e8e93",
                  },
                ]}
              />
              <Text
                style={[
                  styles.lidStateInlineText,
                  scheme === "light" && styles.lidStateInlineTextLight,
                ]}
              >
                Lid State: {lidState
                  ? lidState === "OPEN"
                    ? "Open"
                    : "Closed"
                  : "Unknown"}
              </Text>
            </View>

            {(scheduledLabel || PREVIEW_STATUS) && (
              <Text
                style={[
                  styles.scheduledInlineText,
                  scheme === "light" && styles.scheduledInlineTextLight,
                ]}
              >
                Currently scheduled for{" "}
                <Text style={styles.scheduledInlineTime}>
                  {PREVIEW_STATUS ? "23:27" : scheduledLabel}
                </Text>
              </Text>
            )}
          </View>
        )}

        {(currentDevice || PREVIEW_STATUS) && (
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
            <TouchableOpacity
              disabled={!currentDevice || !currentDevice.online}
              onPress={() => sendCommand("OPEN")}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: "#34C759",
                opacity: !currentDevice || !currentDevice.online ? 0.4 : 1,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#000" }}>
                Open
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={!currentDevice || !currentDevice.online}
              onPress={() => sendCommand("CLOSE")}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 14,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: "#ff3b30",
                opacity: !currentDevice || !currentDevice.online ? 0.4 : 1,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#ff3b30" }}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View
          style={[
            styles.scheduleCard,
            scheme === "light" && styles.scheduleCardLight,
          ]}
        >
          <Text style={[styles.scheduleLabel, { color: colors.textSecondary }]}>
            SCHEDULE FEED
          </Text>

          <TouchableOpacity
            style={[
              styles.timePill,
              scheme === "light" && styles.timePillLight,
            ]}
            onPress={() => {
              if (Platform.OS === "android") {
                androidTempTimeRef.current = new Date(scheduledTime.getTime());
                setShowPicker(true);
              }
            }}
          >
            <Text style={[styles.timeText, { color: colors.text }]}>
              {scheduledTime.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </TouchableOpacity>
          {Platform.OS === "ios" && (
            <DateTimePicker
              value={scheduledTime}
              mode="time"
              display="spinner"
              onChange={(event, date) => {
                if (date) setScheduledTime(date);
              }}
            />
          )}

          {Platform.OS === "android" && androidTimePicker}

          <View style={styles.scheduleButtons}>
            <TouchableOpacity
              onPress={scheduleFeed}
              disabled={
                !currentDevice || !currentDevice.online || hasScheduledFeed
              }
              style={[
                styles.primaryScheduleButton,
                {
                  opacity:
                    !currentDevice || !currentDevice.online || hasScheduledFeed
                      ? 0.4
                      : 1,
                },
              ]}
            >
              <Text style={styles.primaryScheduleText}>Schedule Feed</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={cancelSchedule}
              disabled={
                !currentDevice || !currentDevice.online || !hasScheduledFeed
              }
              style={[
                styles.cancelScheduleButton,
                {
                  opacity:
                    !currentDevice || !currentDevice.online || !hasScheduledFeed
                      ? 0.4
                      : 1,
                },
              ]}
            >
              <Text style={styles.cancelScheduleText}>
                Cancel Scheduled Feed
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Feature request / bug report link */}
      <View
        style={{
          position: "absolute",
          bottom: 90,
          left: 0,
          right: 0,
          alignItems: "center",
        }}
      >
        <TouchableOpacity
          onPress={async () => {
            const url =
              "https://docs.google.com/forms/d/e/1FAIpQLSeK09tSetMjIBSNJGb8ljF9vkiKjq6H_mBQQ83d0lsXaOZrWQ/viewform";
            const supported = await Linking.canOpenURL(url);
            if (supported) {
              await Linking.openURL(url);
            }
          }}
        >
          <Text
            style={{
              fontSize: 13,
              color: colors.textSecondary,
              textDecorationLine: "underline",
            }}
          >
            Found a bug or have a feature idea? Tell us
          </Text>
        </TouchableOpacity>
      </View>

      {/* Dropdown */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setDropdownOpen(false)}
        >
          <View style={[styles.dropdown, { backgroundColor: colors.card }]}>
            {devices.map((device) => (
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
                <Text style={{ color: colors.text, flex: 1, fontSize: 16 }}>
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
  statusPreviewWrapper: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    marginBottom: 20,
    gap: 12,
  },

  statusPill: {
    width: "100%",
    borderRadius: 20,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#2c2c2e",
  },

  statusPillLight: {
    backgroundColor: "#f2f2f7",
  },

  statusPillLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: "600",
    color: "#8e8e93",
    marginBottom: 4,
  },

  statusPillValue: {
    fontSize: 22,
    fontWeight: "700",
    color: "#ffffff",
  },

  lidStatePillSmall: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#2c2c2e",
  },

  lidStatePillSmallLight: {
    backgroundColor: "#f2f2f7",
  },

  lidStateTextSmall: {
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 10,
    color: "#ffffff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: "600",
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-start",
    paddingTop: 90,
    paddingHorizontal: 24,
  },
  dropdown: {
    borderRadius: 18,
    paddingVertical: 12,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
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
    marginTop: 10,
    padding: 24,
    borderRadius: 28,
    backgroundColor: "#1c1c1e",
    alignItems: "center",
  },
  scheduleCardLight: {
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  scheduleLabel: {
    fontSize: 12,
    letterSpacing: 1.2,
    fontWeight: "600",
    marginBottom: 16,
    color: "#8e8e93",
  },

  timePill: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 999,
    backgroundColor: "#2c2c2e",
    marginBottom: 20,
  },
  timePillLight: {
    backgroundColor: "#f2f2f7",
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
  statusLinePill: {
    width: "100%",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: "#2c2c2e",
  },
  statusLinePillLight: {
    backgroundColor: "#f2f2f7",
  },
  statusLineText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#ffffff",
  },
  statusLineTime: {
    fontWeight: "700",
  },

  // New styles for combined status pill and inline status
  combinedStatusPill: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#2c2c2e",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  combinedStatusPillLight: {
    backgroundColor: "#f2f2f7",
  },

  lidStatusInline: {
    flexDirection: "row",
    alignItems: "center",
  },

  lidStateInlineText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
    marginLeft: 8,
  },

  lidStateInlineTextLight: {
    color: "#1c1c1e",
  },

  scheduledInlineText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#ffffff",
  },

  scheduledInlineTextLight: {
    color: "#1c1c1e",
  },

  scheduledInlineTime: {
    fontWeight: "700",
  },
});
