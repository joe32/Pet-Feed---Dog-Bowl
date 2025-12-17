import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, AppState } from "react-native";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "PETFEED_DEVICES";
const LAST_CONNECTED_KEY = "PETFEED_LAST_CONNECTED";

export default function HomeScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  const [devices, setDevices] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    loadDevices();
  }, []);

  useEffect(() => {
    let interval;
    async function checkOnline() {
      if (!currentDevice || !currentDevice.ip) return;

      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 2000);

        await fetch(`http://${currentDevice.ip}/ping`, {
          signal: controller.signal,
        });

        updateDeviceConnection(currentDevice.id, true);
      } catch {
        updateDeviceConnection(currentDevice.id, false);
      }
    }

    interval = setInterval(checkOnline, 5000);
    checkOnline();

    return () => clearInterval(interval);
  }, [currentId]);

  async function loadDevices() {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const last = await AsyncStorage.getItem(LAST_CONNECTED_KEY);

    const parsed = saved ? JSON.parse(saved) : [];
    setDevices(parsed);

    if (last && parsed.find(d => d.id === last)) {
      setCurrentId(last);
    }
  }

  async function switchDevice(device) {
    setCurrentId(device.id);
    await AsyncStorage.setItem(LAST_CONNECTED_KEY, device.id);
    setDropdownOpen(false);
  }

  async function updateDeviceConnection(id, connected) {
    setDevices(prev => {
      const updated = prev.map(d =>
        d.id === id ? { ...d, connected } : d
      );
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  const currentDevice = devices.find(d => d.id === currentId);

  async function sendHello() {
    if (!currentDevice || !currentDevice.ip) return;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`http://${currentDevice.ip}/hello`, {
        method: "POST",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error("Non-200 response");
      }

      console.log("Hello command sent successfully");
    } catch (e) {
      console.log("Send command failed", e);
    }
  }

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
                  { backgroundColor: currentDevice.connected ? "#3ddc84" : "#777" },
                ]}
              />
              <Text
                style={{ color: colors.textSecondary, fontSize: 14 }}
                numberOfLines={1}
              >
                {currentDevice.name} · {currentDevice.connected ? "Online" : "Offline"}
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
          <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 2 }}>
            {currentDevice ? `Connected: ${currentDevice.name}` : "No device connected"}
          </Text>
        </View>

        {/* Right spacer */}
        <View style={styles.rightSlot} />
      </View>

      <View style={styles.centerControl}>
        <TouchableOpacity
          disabled={!currentDevice || !currentDevice.ip}
          onPress={sendHello}
          style={[
            styles.controlButton,
            {
              backgroundColor:
                currentDevice && currentDevice.ip
                  ? colors.tint
                  : colors.icon,
            },
          ]}
        >
          <Text style={{ color: colors.background, fontSize: 18, fontWeight: "600" }}>
            Send Test Command
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
                    { backgroundColor: device.connected ? "#3ddc84" : "#777" },
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
    right: 0,
    alignItems: "center",
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
});
