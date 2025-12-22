const FAKE_BEEP_PREFS = false; // 🔧 TEMP — remove later
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
  ScrollView,
  Switch,
  ActivityIndicator,
  Platform,
  TextInput,
  PermissionsAndroid,
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
import {
  initBle,
  // startScan,
  // stopScan,
  // setBleScanMode,
  // connectToDevice,
  // sendWifiCredentials,
  // subscribeToNotifications,
  // sendClaimCommand,
} from "../ble/bleManager";

const STORAGE_KEY = "PETFEED_DEVICES";
const ACTIVE_DEVICE_KEY = "PETFEED_ACTIVE_DEVICE";

async function pingHost(host) {
  try {
    console.log("[Devices] Requesting /ping for", host);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://${host}.local/ping`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error();
    console.log("[Devices] Requesting /version for", host);
    const vRes = await fetch(`http://${host}.local/version`, {
      signal: controller.signal,
    });
    clearTimeout(t);
    const vJson = await vRes.json();
    return { online: true, firmware: vJson.version };
  } catch (e) {
    console.log(
      "[Devices] /ping or /version failed for",
      host,
      e?.message || e
    );
    return { online: false, firmware: "unavailable" };
  }
}

// Helper to request BLE permissions on Android
async function requestAndroidBlePermissions() {
  if (Platform.OS !== "android") return;

  console.log("[Android][BLE] Requesting BLE permissions");

  try {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);

    console.log("[Android][BLE] Permission results:", result);
  } catch (e) {
    console.error("[Android][BLE] Permission request failed", e);
  }
}

export default function DevicesScreen() {
  // Beep Settings modal state
  const [showBeepModal, setShowBeepModal] = useState(false);
  const [beepLoading, setBeepLoading] = useState(false);
  const [beepPrefs, setBeepPrefs] = useState({
    openClose: false,
    schedule: false,
    feeding: false,
  });
  const [beepDirty, setBeepDirty] = useState(false);
  const [beepHost, setBeepHost] = useState(null);
  // Android device-options modal state
  const [showAndroidOptions, setShowAndroidOptions] = useState(false);
  const [androidOptionsDevice, setAndroidOptionsDevice] = useState(null);
  // Android rename modal state
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameDevice, setRenameDevice] = useState(null);

  // --- Beep Settings helpers ---
  async function loadBeepPrefs(host) {
    setBeepLoading(true);

    // 🔧 TEMP FAKE PREFS FOR TESTING
    if (FAKE_BEEP_PREFS) {
      console.log("[Beep][FAKE] Returning fake buzzer prefs");

      setTimeout(() => {
        setBeepPrefs({
          openClose: true,
          schedule: true,
          feeding: true,
        });
        setBeepLoading(false);
      }, 600);

      return;
    }

    // ---- REAL ESP LOGIC ----
    try {
      console.log("[Beep] Requesting /buzzer-prefs");
      const res = await fetch(`http://${host}.local/buzzer-prefs`);
      const json = await res.json();
      console.log("[Beep] Received prefs", json);

      setBeepPrefs({
        openClose: !!json.openClose,
        schedule: !!json.scheduleChange,
        feeding: !!json.scheduledFeed,
      });
    } catch (e) {
      console.error("[Beep] Failed to load prefs", e);
      Alert.alert("Failed", "Could not load beep settings from device.");
    } finally {
      setBeepLoading(false);
    }
  }

  async function saveBeepPrefs() {
    if (!beepHost) return;
    try {
      console.log("[Beep] POST /buzzer-prefs body", beepPrefs);
      await fetch(`http://${beepHost}.local/buzzer-prefs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(beepPrefs),
      });
      setBeepDirty(false);
      Alert.alert("Saved", "Beep settings updated.");
    } catch (e) {
      console.error("[Beep] Failed to save prefs", e);
      Alert.alert("Failed", "Could not save beep settings.");
    }
  }
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  const [devices, setDevices] = useState([]);
  const [activeDeviceId, setActiveDeviceId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // const [otherDevices, setOtherDevices] = useState([]);
  // const [scanning, setScanning] = useState(true);
  // const [scanTimedOut, setScanTimedOut] = useState(false);
  // Modal state for adding local device
  const [addingLocalDevice, setAddingLocalDevice] = useState(null);
  const [localDeviceName, setLocalDeviceName] = useState("");

  const loadDevices = useCallback(async () => {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const active = await AsyncStorage.getItem(ACTIVE_DEVICE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    const normalised = parsed.map((d) => {
      const { updateAvailable, updateVersion, updateUnknown, ...rest } = d;
      return {
        ...rest,
        mode: d.mode || "wifi",
        online: typeof d.online === "boolean" ? d.online : false,
      };
    });
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

  // 🔧 TEMP: fake devices for Expo Go preview

  // useEffect(() => {
  //   setDevices([
  //     {
  //       id: "FAKE-DEVICE-001",
  //       name: "Pet Feeder",
  //       host: "petfeeder-kitchen",
  //       mode: "wifi",
  //       online: true,
  //       beepPrefs: {
  //         openClose: true,
  //         schedule: true,
  //         feeding: true,
  //       },
  //     },
  //     {
  //       id: "FAKE-DEVICE-002",
  //       name: "feeder",
  //       host: "petfeeder-garden",
  //       mode: "local",
  //       online: false,
  //       beepPrefs: {
  //         openClose: true,
  //         schedule: true,
  //         feeding: true,
  //       },
  //     },
  //   ]);

  //   setActiveDeviceId("FAKE-DEVICE-001");
  // }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    (async () => {
      await requestAndroidBlePermissions();
      try {
        initBle();
      } catch {}
    })();
  }, []);

  // 🔁 Re-sync active device when returning to this screen (NO update check)
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

  // useFocusEffect(
  //   useCallback(() => {
  //     setScanning(true);
  //     setScanTimedOut(false);
  //     setOtherDevices([]);
  //
  //     // Switch BLE into CLAIM mode for "other devices"
  //     setBleScanMode("claim");
  //     stopScan();
  //
  //     startScan(
  //       (device) => {
  //         setOtherDevices((prev) => {
  //           // Do not show devices that are already saved in "My Devices"
  //           if (devices.find((d) => d.id === device.id)) return prev;
  //
  //           // Do not add duplicates
  //           if (prev.find((d) => d.id === device.id)) return prev;
  //
  //           return [
  //             ...prev,
  //             {
  //               id: device.id,
  //               name: device.name || "PetFeeder",
  //             },
  //           ];
  //         });
  //       },
  //       () => {}
  //     );
  //
  //     const timeout = setTimeout(() => {
  //       stopScan();
  //       setScanning(false);
  //       setScanTimedOut(true);
  //     }, 10000);
  //
  //     return () => {
  //       clearTimeout(timeout);
  //       stopScan();
  //     };
  //   }, [])
  // );

  useEffect(() => {
    (async () => {
      if (!devices.length) return;

      console.log(
        "[Devices] Initial screen load: fetching /ping + /version for all devices"
      );

      const updated = await Promise.all(
        devices.map(async (d) => {
          if (!d.host) return d;

          const result = await pingHost(d.host);

          return {
            ...d,
            online: result.online,
            firmware: result.firmware ?? "unavailable",
          };
        })
      );

      setDevices(updated);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    })();
    // run ONLY once on screen mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 🔁 Poll device version every 5 seconds while on Devices screen
  useEffect(() => {
    if (!devices.length) return;

    const interval = setInterval(async () => {
      console.log("[Devices] 5s poll: fetching /version for all devices");

      const updated = await Promise.all(
        devices.map(async (d) => {
          if (!d.host) return d;

          const result = await pingHost(d.host);

          return {
            ...d,
            online: result.online,
            firmware: result.firmware ?? "unavailable",
          };
        })
      );

      setDevices(updated);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }, 5000);

    return () => clearInterval(interval);
  }, [devices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);

    console.log(
      "[Devices] Pull-to-refresh: fetching /ping + /version for all devices"
    );

    const updated = await Promise.all(
      devices.map(async (d) => {
        if (!d.host) return d;

        const result = await pingHost(d.host);

        return {
          ...d,
          online: result.online,
          firmware: result.firmware ?? "unavailable",
        };
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
    // Prevent factory reset for local devices
    if (device.mode === "local") {
      const updated = devices.filter((d) => d.id !== device.id);
      setDevices(updated);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return;
    }
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
    if (Platform.OS === "android") {
      setAndroidOptionsDevice(device);
      setShowAndroidOptions(true);
      return;
    }
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
        text: "Update Settings",
        onPress: () => {
          if (!device.online) {
            Alert.alert(
              "Device offline",
              "Update settings can only be accessed while the device is online."
            );
            return;
          }

          router.push({
            pathname: "/(device-setup)/updates",
            params: { host: device.host, name: device.name },
          });
        },
      },
      // Insert Beep Settings option before Device Details
      {
        text: "Beep Settings",
        onPress: async () => {
          if (!device.online) {
            Alert.alert(
              "Device offline",
              "Beep settings can only be changed while the device is online."
            );
            return;
          }
          setBeepHost(device.host);
          setShowBeepModal(true);
          setBeepDirty(false);
          await loadBeepPrefs(device.host);
        },
      },
      // Only render Edit Wi‑Fi for non-local devices
      ...(device.mode !== "local"
        ? [
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
                          await fetch(
                            `http://${device.host}.local/update-wifi`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ ssid, password }),
                            }
                          );

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
          ]
        : []),
      {
        text: "Device Details",
        onPress: () => {
          Alert.alert(
            "Device Details",
            `Name: ${device.name}
ID: ${device.id}
Hostname (mDNS): ${device.host}.local
Connection: ${device.mode === "local" ? "Local device" : "Wi‑Fi (local)"}
Mode: ${device.mode}
Status: ${device.online ? "Online" : "Offline"}
Firmware: ${device.firmware || "Unknown"}`,
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
              {/* Device name only */}
              <Text style={[styles.deviceName, { color: colors.text }]}>
                {device.name}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                  {isActive ? "Selected" : "Not selected"} ·{" "}
                  {device.online ? "Online" : "Offline"}
                </Text>
              </View>
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 13,
                  marginTop: 2,
                }}
              >
                Connection:{" "}
                {device.mode === "local" ? "Local device" : "Wi‑Fi (local)"}
              </Text>
            </View>

            <View style={{ alignItems: "flex-end", marginLeft: 12 }}>
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                Version{" "}
                {device.firmware === "unavailable"
                  ? "Unavailable"
                  : device.firmware}
              </Text>

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

  // function retryDiscovery() {
  //   setOtherDevices([]);
  //   setScanTimedOut(false);
  //   setScanning(true);
  //
  //   setBleScanMode("claim");
  //   stopScan();
  //
  //   startScan(
  //     (device) => {
  //       setOtherDevices((prev) => {
  //         // Do not show devices that are already saved in "My Devices"
  //         if (devices.find((d) => d.id === device.id)) return prev;
  //
  //         // Do not add duplicates
  //         if (prev.find((d) => d.id === device.id)) return prev;
  //
  //         return [
  //           ...prev,
  //           {
  //             id: device.id,
  //             name: device.name || "PetFeeder",
  //           },
  //         ];
  //       });
  //     },
  //     () => {}
  //   );
  //
  //   setTimeout(() => {
  //     stopScan();
  //     setScanning(false);
  //     setScanTimedOut(true);
  //   }, 10000);
  // }

  // function renderOtherDevice(device) {
  //   return (
  //     <View
  //       key={device.id}
  //       style={[styles.card, { backgroundColor: colors.card, opacity: 0.9 }]}
  //     >
  //       <View style={[styles.statusDot, { backgroundColor: "#34C759" }]} />
  //       <View style={{ flex: 1 }}>
  //         <Text style={[styles.deviceName, { color: colors.text }]}>
  //           {device.name}
  //         </Text>
  //         <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
  //           {device.id}
  //         </Text>
  //       </View>
  //       <TouchableOpacity
  //         onPress={async () => {
  //           try {
  //             setBleScanMode("claim");
  //             await connectToDevice(device.id);
  //
  //             // Ask ESP for its hostname via CLAIM
  //             let resolvedHost = null;
  //
  //             const unsub = subscribeToNotifications((msg) => {
  //               if (typeof msg === "string" && msg.startsWith("HOST:")) {
  //                 resolvedHost = msg.replace("HOST:", "").trim();
  //               }
  //             });
  //
  //             await sendClaimCommand();
  //
  //             // wait briefly for notification
  //             await new Promise((r) => setTimeout(r, 500));
  //             unsub();
  //
  //             if (!resolvedHost) {
  //               throw new Error("No hostname returned from device");
  //             }
  //
  //             setAddingLocalDevice({
  //               ...device,
  //               host: resolvedHost,
  //             });
  //             setLocalDeviceName(device.name);
  //           } catch (e) {
  //             Alert.alert(
  //               "Connection failed",
  //               "Could not claim this device. Make sure it is powered on and nearby."
  //             );
  //           }
  //         }}
  //       >
  //         <Text style={{ color: colors.tint, fontWeight: "600" }}>Add</Text>
  //       </TouchableOpacity>
  //     </View>
  //   );
  // }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>My Devices</Text>
          <TouchableOpacity
            onPress={() => {
              router.push("/(device-setup)/add-device");
            }}
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
            <>{devices.map(renderDevice)}</>
          )}
          {/*
          <View style={{ marginTop: 32 }}>
            <Text
              style={[styles.sectionTitle, { color: colors.textSecondary }]}
            >
              Other devices on your network
            </Text>

            {scanning && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <ActivityIndicator
                  size="small"
                  color={colors.textSecondary}
                  style={{ marginRight: 8 }}
                />
                <Text style={{ color: colors.textSecondary }}>
                  Scanning nearby devices via Bluetooth…
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
          */}
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
      </SafeAreaView>
      {showAndroidOptions && androidOptionsDevice && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {androidOptionsDevice.name}
            </Text>
            <Text style={{ color: colors.textSecondary, marginBottom: 16 }}>
              Choose an option
            </Text>

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => {
                setShowAndroidOptions(false);
                setRenameDevice(androidOptionsDevice);
                setRenameValue(androidOptionsDevice.name);
                setShowRenameModal(true);
              }}
            >
              <Text style={{ fontWeight: "600" }}>Rename</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => {
                setShowAndroidOptions(false);
                if (!androidOptionsDevice.online) {
                  Alert.alert(
                    "Device offline",
                    "Update settings can only be accessed while the device is online."
                  );
                  return;
                }
                router.push({
                  pathname: "/(device-setup)/updates",
                  params: {
                    host: androidOptionsDevice.host,
                    name: androidOptionsDevice.name,
                  },
                });
              }}
            >
              <Text style={{ fontWeight: "600" }}>Update Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalButton}
              onPress={async () => {
                setShowAndroidOptions(false);
                if (!androidOptionsDevice.online) {
                  Alert.alert(
                    "Device offline",
                    "Beep settings can only be changed while the device is online."
                  );
                  return;
                }
                setBeepHost(androidOptionsDevice.host);
                setShowBeepModal(true);
                setBeepDirty(false);
                await loadBeepPrefs(androidOptionsDevice.host);
              }}
            >
              <Text style={{ fontWeight: "600" }}>Beep Settings</Text>
            </TouchableOpacity>

            {androidOptionsDevice.mode !== "local" && (
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => {
                  setShowAndroidOptions(false);
                  if (!androidOptionsDevice.online) {
                    Alert.alert(
                      "Device offline",
                      "Wi‑Fi settings can only be changed while the device is online."
                    );
                    return;
                  }
                  Alert.alert(
                    "Edit Wi‑Fi",
                    "Wi‑Fi changes are supported on this device."
                  );
                }}
              >
                <Text style={{ fontWeight: "600" }}>Edit Wi‑Fi</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => {
                setShowAndroidOptions(false);
                Alert.alert(
                  "Device Details",
                  `Name: ${androidOptionsDevice.name}
ID: ${androidOptionsDevice.id}
Hostname: ${androidOptionsDevice.host}.local
Status: ${androidOptionsDevice.online ? "Online" : "Offline"}
Firmware: ${androidOptionsDevice.firmware || "Unknown"}`
                );
              }}
            >
              <Text style={{ fontWeight: "600" }}>Device Details</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowAndroidOptions(false)}
              style={{ marginTop: 12 }}
            >
              <Text style={{ textAlign: "center", color: colors.textSecondary }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {addingLocalDevice && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Add local device
            </Text>

            <Text style={{ color: colors.textSecondary, marginBottom: 12 }}>
              This device will be added as a local device on your network.
            </Text>

            <TextInput
              value={localDeviceName}
              onChangeText={setLocalDeviceName}
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.tint },
              ]}
            />

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.tint }]}
              onPress={async () => {
                const saved = await AsyncStorage.getItem(STORAGE_KEY);
                const parsed = saved ? JSON.parse(saved) : [];

                const newDevice = {
                  id: addingLocalDevice.id,
                  name: localDeviceName,
                  host: addingLocalDevice.host,
                  hostname: `${addingLocalDevice.host}.local`,
                  mode: "local",
                  online: true,
                };

                const updated = [...parsed, newDevice];
                await AsyncStorage.setItem(
                  STORAGE_KEY,
                  JSON.stringify(updated)
                );
                setDevices(updated);

                setAddingLocalDevice(null);
                setLocalDeviceName("");
              }}
            >
              <Text style={{ color: colors.background, fontWeight: "600" }}>
                Save
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setAddingLocalDevice(null)}
              style={{ marginTop: 12 }}
            >
              <Text
                style={{ color: colors.textSecondary, textAlign: "center" }}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {showBeepModal && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Beep Settings
            </Text>

            {beepLoading ? (
              <ActivityIndicator size="small" color={colors.tint} />
            ) : (
              <>
                {[
                  { key: "openClose", label: "Beep on open / close" },
                  { key: "schedule", label: "Beep on schedule changes" },
                  { key: "feeding", label: "Beep on scheduled feeding" },
                ].map((item) => (
                  <View
                    key={item.key}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginVertical: 8,
                    }}
                  >
                    <Text style={{ color: colors.text }}>{item.label}</Text>
                    <Switch
                      disabled={beepLoading}
                      value={beepPrefs[item.key]}
                      onValueChange={(v) => {
                        setBeepPrefs((p) => ({ ...p, [item.key]: v }));
                        setBeepDirty(true);
                      }}
                    />
                  </View>
                ))}

                <TouchableOpacity
                  disabled={!beepDirty}
                  onPress={saveBeepPrefs}
                  style={[
                    styles.modalButton,
                    {
                      backgroundColor: beepDirty ? colors.tint : "#ccc",
                      marginTop: 16,
                    },
                  ]}
                >
                  <Text style={{ color: colors.background, fontWeight: "600" }}>
                    Save
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              onPress={() => setShowBeepModal(false)}
              style={{ marginTop: 12 }}
            >
              <Text
                style={{ color: colors.textSecondary, textAlign: "center" }}
              >
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {showRenameModal && renameDevice && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Rename device
            </Text>

            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.tint },
              ]}
              placeholder="Device name"
            />

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.tint }]}
              onPress={async () => {
                if (!renameValue.trim()) return;

                const updated = devices.map((d) =>
                  d.id === renameDevice.id ? { ...d, name: renameValue.trim() } : d
                );

                setDevices(updated);
                await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

                setShowRenameModal(false);
                setRenameDevice(null);
                setRenameValue("");
              }}
            >
              <Text style={{ color: colors.background, fontWeight: "600" }}>
                Save
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setShowRenameModal(false);
                setRenameDevice(null);
              }}
              style={{ marginTop: 12 }}
            >
              <Text style={{ color: colors.textSecondary, textAlign: "center" }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
  // Modal styles for local device add
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  modal: {
    width: "85%",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 12,
    fontSize: 17,
    marginBottom: 16,
  },
  modalButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
});
