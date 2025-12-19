import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, ScrollView, RefreshControl } from "react-native";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

  async function fetchLidState() {
    if (!currentDevice || !currentDevice.hostname) return;

    try {
      const res = await fetch(`http://${currentDevice.hostname}/GETSTATE`);
      const json = await res.json();
      setLidState(json.state);
    } catch (e) {
      console.log("Failed to fetch lid state", e);
    }
  }

  useFocusEffect(
    useCallback(() => {
      loadDevices();
      fetchLidState();
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

      // Also poll lid state continuously (every tick)
      if (currentDeviceUpdated && currentDeviceUpdated.online) {
        try {
          const res = await fetch(`http://${currentDeviceUpdated.hostname}/GETSTATE`);
          const json = await res.json();
          setLidState(json.state);
        } catch {}
      }
    }

    interval = setInterval(checkAllDevices, 1000);
    checkAllDevices();

    return () => clearInterval(interval);
  }, [devices, currentId]);

  async function switchDevice(device) {
    setCurrentId(device.id);
    await AsyncStorage.setItem(ACTIVE_DEVICE_KEY, device.id);
    setDropdownOpen(false);
    // Do not mark online here
  }

  const currentDevice = devices.find(d => d.id === currentId);
  const controlsDisabled = !currentDevice || currentDevice.online === false;

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
    await fetchLidState();
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
          <Text style={[styles.title, { color: colors.text }]}>Control</Text>
        </View>

        {/* Right spacer */}
        <View style={styles.rightSlot} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center" }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View
          style={[
            styles.controlCard,
            scheme === "light" && {
              backgroundColor: "#ffffff",
              shadowColor: "#000",
              shadowOpacity: 0.08,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 6,
            },
          ]}
        >
          <Text
            style={[
              styles.lidLabel,
              { color: scheme === "light" ? "#6e6e73" : colors.textSecondary },
            ]}
          >
            LID STATUS
          </Text>

          <View
            style={[
              styles.lidStatePill,
              scheme === "light" && {
                backgroundColor: "#f2f2f7",
              },
            ]}
          >
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
                styles.lidStateText,
                { color: scheme === "light" ? "#1c1c1e" : colors.text },
              ]}
            >
              {lidState
                ? lidState === "OPEN"
                  ? "Open"
                  : "Closed"
                : "Unknown"}
            </Text>
          </View>

          <View style={styles.buttonGroup}>
            <TouchableOpacity
              onPress={() => sendCommand("OPEN")}
              style={[
                styles.primaryScheduleButton,
                {
                  opacity: controlsDisabled ? 0.4 : 1,
                },
              ]}
              disabled={controlsDisabled}
            >
              <Text style={styles.primaryScheduleText}>Open Lid</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => sendCommand("CLOSE")}
              style={[
                styles.cancelScheduleButton,
                {
                  opacity: controlsDisabled ? 0.4 : 1,
                },
              ]}
              disabled={controlsDisabled}
            >
              <Text style={styles.cancelScheduleText}>Close Lid</Text>
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
  controlButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 20,
  },
  controlRow: {
    flexDirection: "column",
    gap: 16,
    alignItems: "center",
  },

  controlCard: {
    width: "100%",
    maxWidth: 360,
    padding: 24,
    borderRadius: 28,
    alignItems: "center",
    backgroundColor: "#1c1c1e", // default for dark mode
  },

  lidLabel: {
    fontSize: 12,
    letterSpacing: 1.2,
    fontWeight: "600",
    marginBottom: 12,
  },

  lidStatePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    marginBottom: 32,
    backgroundColor: "#2c2c2e", // dark default
  },

  lidDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },

  lidStateText: {
    fontSize: 20,
    fontWeight: "600",
  },

  buttonGroup: {
    width: "100%",
    gap: 16,
  },

  primaryButton: {
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: "center",
  },

  primaryButtonText: {
    color: "#000",
    fontSize: 18,
    fontWeight: "700",
  },

  secondaryButton: {
    paddingVertical: 16,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: "center",
  },

  secondaryButtonText: {
    fontSize: 17,
    fontWeight: "600",
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
