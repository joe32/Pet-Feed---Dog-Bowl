import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Swipeable,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { startPetfeedDiscovery, stopPetfeedDiscovery } from "../network/petfeedDiscovery";

const STORAGE_KEY = "PETFEED_DEVICES";
const ACTIVE_DEVICE_KEY = "PETFEED_ACTIVE_DEVICE";

async function pingHost(host) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://${host}.local/ping`, {
      signal: controller.signal,
    });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export default function DevicesScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  const [devices, setDevices] = useState([]);
  const [activeDeviceId, setActiveDeviceId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [otherDevices, setOtherDevices] = useState([]);
  const [scanning, setScanning] = useState(true);
  const [scanTimedOut, setScanTimedOut] = useState(false);

  const loadDevices = useCallback(async () => {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const active = await AsyncStorage.getItem(ACTIVE_DEVICE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    const normalised = parsed.map((d) => ({
      ...d,
      mode: d.mode || "wifi",
      online: typeof d.online === "boolean" ? d.online : false,
    }));
    setDevices(normalised);

    // Auto-select newly added device if none is currently selected
    if (active && normalised.some((d) => d.id === active)) {
      setActiveDeviceId(active);
    } else if (normalised.length > 0) {
      const newest = normalised[normalised.length - 1];
      setActiveDeviceId(newest.id);
      await AsyncStorage.setItem(ACTIVE_DEVICE_KEY, newest.id);
    }
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // 🔧 DEV ONLY — seed fake devices for Expo Go testing
  
  // useEffect(() => {
  //   (async () => {
  //     const fakeDevices = [
  //       {
  //         id: "dev-001",
  //         name: "Kitchen Feeder",
  //         host: "petfeeder-kitchen",
  //         mode: "wifi",
  //         online: true,
  //       },
  //       {
  //         id: "dev-002",
  //         name: "Garage Feeder",
  //         host: "petfeeder-garage",
  //         mode: "wifi",
  //         online: false,
  //       },
  //       {
  //         id: "dev-003",
  //         name: "Holiday Feeder",
  //         host: "petfeeder-holiday",
  //         mode: "wifi",
  //         online: true,
  //       },
  //     ];

  //     await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fakeDevices));
  //     await AsyncStorage.setItem(ACTIVE_DEVICE_KEY, "dev-001");
  //     await loadDevices();
  //   })();
  // }, []);

  // 🔁 Re-sync active device when returning to this screen
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const active = await AsyncStorage.getItem(ACTIVE_DEVICE_KEY);
        if (active) {
          setActiveDeviceId(active);
        }
      })();
    }, [])
  );


useFocusEffect(
  useCallback(() => {
    setScanning(true);
    setScanTimedOut(false);
    setOtherDevices([]);

    stopPetfeedDiscovery();

    startPetfeedDiscovery((found) => {
      const existingHosts = new Set(devices.map(d => d.host));
      const filtered = found.filter(d => !existingHosts.has(d.host));
      setOtherDevices(filtered);
    });

    const timeout = setTimeout(() => {
      stopPetfeedDiscovery();
      setScanning(false);
      setScanTimedOut(true);
    }, 10000);

    return () => {
      clearTimeout(timeout);
      stopPetfeedDiscovery();
    };
  }, [devices])
);

  useEffect(() => {
    const id = setInterval(async () => {
      if (devices.length === 0) return;
      const updated = await Promise.all(
        devices.map(async (d) => {
          if (!d.host) return d;
          const online = await pingHost(d.host);
          return { ...d, online };
        })
      );
      setDevices(updated);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }, 5000);
    return () => clearInterval(id);
  }, [devices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const updated = await Promise.all(
      devices.map(async (d) => {
        if (!d.host) return d;
        const online = await pingHost(d.host);
        return { ...d, online };
      })
    );
    setDevices(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setRefreshing(false);
  }, [devices]);

  async function selectDevice(device) {
    setActiveDeviceId(device.id);
    await AsyncStorage.setItem(ACTIVE_DEVICE_KEY, device.id);
  }

  async function removeDevice(device) {
    // If device is OFFLINE, warn user and allow force delete
    if (!device.online) {
      Alert.alert(
        "Device offline",
        "This device is not currently connected. If you delete it now, it will NOT be factory reset and may remain paired.\n\nYou can force delete it from the app only.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Force delete",
            style: "destructive",
            onPress: async () => {
              const updated = devices.filter((d) => d.id !== device.id);
              setDevices(updated);
              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
              if (activeDeviceId === device.id) {
                setActiveDeviceId(null);
                await AsyncStorage.removeItem(ACTIVE_DEVICE_KEY);
              }
            },
          },
        ]
      );
      return;
    }

    // Device is ONLINE — normal delete + factory reset
    Alert.alert(
      "Remove device?",
      `Remove "${device.name}" and factory reset it?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (device.host) {
              try {
                await fetch(`http://${device.host}.local/factory-reset`, {
                  method: "POST",
                });
              } catch {}
            }
            const updated = devices.filter((d) => d.id !== device.id);
            setDevices(updated);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            if (activeDeviceId === device.id) {
              setActiveDeviceId(null);
              await AsyncStorage.removeItem(ACTIVE_DEVICE_KEY);
            }
          },
        },
      ]
    );
  }

  function openDeviceSettings(device) {
    Alert.alert(device.name, "Choose an option", [
      {
        text: "Rename",
        onPress: () => {
          Alert.prompt(
            "Rename device",
            "This only changes the name in the app",
            async (text) => {
              if (!text) return;
              const updated = devices.map((d) =>
                d.id === device.id ? { ...d, name: text } : d
              );
              setDevices(updated);
              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            }
          );
        },
      },
      {
        text: "Edit Wi‑Fi",
        onPress: () => {
          if (!device.online) {
            Alert.alert(
              "Device offline",
              "Wi‑Fi settings can only be changed while the device is online."
            );
            return;
          }

          Alert.prompt(
            "Wi‑Fi SSID",
            "Enter the new Wi‑Fi network name",
            (ssid) => {
              if (!ssid) return;

              Alert.prompt(
                "Wi‑Fi Password",
                "Enter the Wi‑Fi password",
                async (password) => {
                  try {
                    await fetch(`http://${device.host}.local/update-wifi`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ ssid, password }),
                    });

                    Alert.alert(
                      "Updating Wi‑Fi",
                      "Saved. The device will reboot and attempt to connect to the new Wi‑Fi network."
                    );
                  } catch {
                    Alert.alert(
                      "Failed",
                      "Could not send Wi‑Fi details to the device."
                    );
                  }
                },
                "secure-text"
              );
            }
          );
        },
      },
      {
        text: "Device Details",
        onPress: () => {
          Alert.alert(
            "Device Details",
            `Name: ${device.name}
ID: ${device.id}
Hostname (mDNS): ${device.host}.local
Connection: Wi‑Fi (local)
Mode: ${device.mode}
Status: ${device.online ? "Online" : "Offline"}
IP Address: Unknown`,
            [{ text: "OK" }]
          );
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function renderDevice(device) {
    const isActive = activeDeviceId === device.id;

    return (
      <Swipeable
        key={device.id}
        renderLeftActions={() => (
          <TouchableOpacity
            style={[styles.leftAction, { backgroundColor: "#ff3b30" }]}
            onPress={() => removeDevice(device)}
          >
            <Text style={{ color: "#fff", fontWeight: "600" }}>Delete</Text>
          </TouchableOpacity>
        )}
      >
        <View>
          <TouchableOpacity
            onPress={() => selectDevice(device)}
            style={[
              styles.card,
              { backgroundColor: isActive ? colors.card : colors.card },
              isActive && styles.cardSelected,
              isActive && { borderColor: colors.tint },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: device.online ? "#34C759" : "#8e8e93" },
              ]}
            />

            <View style={{ flex: 1 }}>
              <Text style={[styles.deviceName, { color: colors.text }]}>
                {device.name}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                {isActive ? "Selected" : "Not selected"} ·{" "}
                {device.online ? "Online" : "Offline"}
              </Text>
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 13,
                  marginTop: 2,
                }}
              >
                Connection: Wi‑Fi (local)
              </Text>
            </View>

            <View style={styles.inlineActions}>
              <TouchableOpacity onPress={() => openDeviceSettings(device)}>
                <Ionicons
                  name="settings-outline"
                  size={22}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => removeDevice(device)}
                style={{ marginLeft: 12 }}
              >
                <Ionicons name="trash-outline" size={22} color="#ff3b30" />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>

          <View
            style={[
              styles.rowSeparator,
              { backgroundColor: colors.textSecondary, opacity: 0.25 },
            ]}
          />
        </View>
      </Swipeable>
    );
  }

function retryDiscovery() {
  stopPetfeedDiscovery();
  setOtherDevices([]);
  setScanTimedOut(false);
  setScanning(true);

  startPetfeedDiscovery((found) => {
    const existingHosts = new Set(devices.map(d => d.host));
    const filtered = found.filter(d => !existingHosts.has(d.host));
    setOtherDevices(filtered);
  });

  setTimeout(() => {
    stopPetfeedDiscovery();
    setScanning(false);
    setScanTimedOut(true);
  }, 10000);
}

  function renderOtherDevice(device) {
    return (
      <View key={device.host} style={[styles.card, { backgroundColor: colors.card, opacity: 0.9 }]}>
        <View style={[styles.statusDot, { backgroundColor: "#34C759" }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.deviceName, { color: colors.text }]}>
            {device.host}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
            Other device on your network
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            router.push({
              pathname: "/(device-setup)/add-device",
              params: { discoveredHost: device.host },
            });
          }}
        >
          <Text style={{ color: colors.tint, fontWeight: "600" }}>Add</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>My Devices</Text>
          <TouchableOpacity
            onPress={() => router.push("/(device-setup)/add-device")}
          >
            <Text style={{ color: colors.tint, fontSize: 16 }}>
              Add Device +
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1, paddingHorizontal: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.tint}
            />
          }
        >
          {devices.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.title, { color: colors.text }]}>
                No devices
              </Text>
            </View>
          ) : (
            <>
              {devices.map(renderDevice)}
            </>
          )}
          <View style={{ marginTop: 32 }}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              Other devices on your network
            </Text>

            {scanning && (
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
                <ActivityIndicator
                  size="small"
                  color={colors.textSecondary}
                  style={{ marginRight: 8 }}
                />
                <Text style={{ color: colors.textSecondary }}>
                  Scanning your network…
                </Text>
              </View>
            )}

            {!scanning && scanTimedOut && otherDevices.length === 0 && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ color: colors.textSecondary, marginBottom: 6 }}>
                  No other PetFeed devices found
                </Text>
                <TouchableOpacity onPress={retryDiscovery}>
                  <Text style={{ color: colors.tint, fontWeight: "600" }}>
                    Retry scan
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {otherDevices.map(renderOtherDevice)}
          </View>
        </ScrollView>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 32, fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", marginTop: 80 },
  card: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  deviceName: { fontSize: 18, fontWeight: "600" },
  inlineActions: { flexDirection: "row", alignItems: "center", marginLeft: 12 },
  leftAction: {
    justifyContent: "center",
    alignItems: "center",
    width: 90,
  },

  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },

  cardSelected: {
    borderWidth: 2,
  },

  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 24,
    marginRight: 24,
    marginBottom: 12,
    borderRadius: 999,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
