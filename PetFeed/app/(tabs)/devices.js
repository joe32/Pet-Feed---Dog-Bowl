import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, RefreshControl, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Swipeable, GestureHandlerRootView } from "react-native-gesture-handler";
import { startOnlinePolling, stopOnlinePolling, forceReachabilityRefresh } from "../network/petfeedReachability";

const STORAGE_KEY = "PETFEED_DEVICES";
const ACTIVE_DEVICE_KEY = "PETFEED_ACTIVE_DEVICE";

export default function DevicesScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  const [devices, setDevices] = useState([]);
  const [activeDeviceId, setActiveDeviceId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    React.useCallback(() => {
      loadDevices();
      startOnlinePolling();

      return () => {
        stopOnlinePolling();
      };
    }, [])
  );
  
//fake devices
//   useFocusEffect(
//   React.useCallback(() => {
//     (async () => {
//       await AsyncStorage.setItem(
//         "PETFEED_DEVICES",
//         JSON.stringify([
//           {
//             id: "dummy-1",
//             name: "PetFeed Kitchen",
//             mode: "wifi",
//             online: true,
//           },
//           {
//             id: "dummy-2",
//             name: "PetFeed Garage",
//             mode: "wifi",
//             online: true,
//           },
//         ])
//       );

//       await AsyncStorage.setItem("PETFEED_ACTIVE_DEVICE", "dummy-1");

//       loadDevices();
//     })();
//   }, [])
// );

  async function loadDevices() {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const active = await AsyncStorage.getItem(ACTIVE_DEVICE_KEY);

    const parsed = saved
      ? JSON.parse(saved).map(d => ({
          ...d,
          mode: d.mode || "wifi",
        }))
      : [];
    setDevices(parsed);
    setActiveDeviceId(active);
  }

  async function refreshDevices() {
    setRefreshing(true);
    await forceReachabilityRefresh();
    await loadDevices();
    setRefreshing(false);
  }

  async function saveDevices(updated) {
    setDevices(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  async function handleDevicePress(device) {
    if (activeDeviceId === device.id) return;

    Alert.alert(
      "Switch device?",
      `Control "${device.name}" instead?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Switch",
          onPress: async () => {
            setActiveDeviceId(device.id);
            await AsyncStorage.setItem(ACTIVE_DEVICE_KEY, device.id);
          },
        },
      ]
    );
  }

  async function removeDevice(device) {
    Alert.alert(
      "Remove device?",
      `Remove "${device.name}" from this app?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            // Trigger factory reset on ESP (best‑effort)
            if (device.ip) {
              try {
                await fetch(`http://${device.ip}/factory-reset`, {
                  method: "POST",
                });
                console.log("Factory reset requested for device:", device.name);
              } catch (e) {
                console.log("Factory reset request failed:", e);
              }
            }

            const updated = devices.filter(d => d.id !== device.id);
            await saveDevices(updated);

            if (activeDeviceId === device.id) {
              setActiveDeviceId(null);
              await AsyncStorage.removeItem(ACTIVE_DEVICE_KEY);
            }
          },
        },
      ]
    );
  }

  async function renameDevice(device) {
    Alert.prompt(
      "Rename device",
      "Enter a new name",
      async (name) => {
        if (!name) return;
        const updated = devices.map(d =>
          d.id === device.id ? { ...d, name } : d
        );
        await saveDevices(updated);
      },
      "plain-text",
      device.name
    );
  }

  async function updateMode(device, mode) {
    const updated = devices.map(d =>
      d.id === device.id ? { ...d, mode } : d
    );
    await saveDevices(updated);
  }

  function renderRightActions(device) {
    return (
      <TouchableOpacity
        style={[styles.rightAction, { backgroundColor: colors.background }]}
        onPress={() =>
          Alert.alert("Device options", device.name, [
            {
              text: "Switch connection mode",
              onPress: () =>
                Alert.alert("Connection mode", "", [
                  { text: "Wi‑Fi (local)", onPress: async () => updateMode(device, "wifi") },
                  { text: "Cloud (coming soon)", style: "destructive" },
                  { text: "Cancel", style: "cancel" },
                ]),
            },
            { text: "Rename", onPress: () => renameDevice(device) },
            { text: "Remove", style: "destructive", onPress: () => removeDevice(device) },
            { text: "Cancel", style: "cancel" },
          ])
        }
      >
        <Text style={{ fontSize: 22, color: colors.textSecondary, padding: 16 }}>⚙︎</Text>
      </TouchableOpacity>
    );
  }

  function renderLeftActions(device) {
    return (
      <TouchableOpacity
        style={[styles.leftAction, { backgroundColor: "#ff3b30", justifyContent: "center", alignItems: "center" }]}
        onPress={() => removeDevice(device)}
      >
        <Text style={{ color: "#fff", fontWeight: "600", padding: 16 }}>Delete</Text>
      </TouchableOpacity>
    );
  }

  function renderDevice(device) {
    const isActive = activeDeviceId === device.id;

    return (
      <Swipeable
        key={device.id}
        renderLeftActions={() => renderLeftActions(device)}
        renderRightActions={() => renderRightActions(device)}
      >
        <TouchableOpacity
          onPress={() => handleDevicePress(device)}
          style={[styles.card, { backgroundColor: colors.card }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.deviceName, { color: colors.text }]}>
              {device.name}
            </Text>

            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  marginRight: 6,
                  backgroundColor: device.online ? "#3ddc84" : "#777",
                }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                {isActive ? "Selected" : "Not selected"} · {device.online ? "Online" : "Offline"}
              </Text>
            </View>

            <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
              Connection: {device.mode === "wifi" ? "Wi‑Fi (local)" : "Cloud"}
            </Text>
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>My Devices</Text>

          {devices.length > 0 && (
            <TouchableOpacity onPress={() => router.push("/(device-setup)/add-device")}>
              <Text style={{ color: colors.tint, fontSize: 16 }}>Add</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          style={{ flex: 1, paddingHorizontal: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshDevices}
              tintColor={colors.tint}
            />
          }
        >
          {devices.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.title, { color: colors.text, textAlign: "center" }]}>
                No devices
              </Text>
              <Text style={{ color: colors.textSecondary, marginVertical: 16, textAlign: "center" }}>
                Add a pet feeder to get started
              </Text>
              <TouchableOpacity
                onPress={() => router.push("/(device-setup)/add-device")}
                style={[styles.addButton, { backgroundColor: colors.tint }]}
              >
                <Text style={{ color: colors.onPrimary, fontWeight: "600" }}>
                  Add New Device
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            devices.map(renderDevice)
          )}
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
  title: {
    fontSize: 32,
    fontWeight: "600",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  addButton: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  deviceName: {
    fontSize: 18,
    fontWeight: "600",
  },
  rightAction: {
    justifyContent: "center",
    alignItems: "center",
  },
  leftAction: {
    justifyContent: "center",
    alignItems: "center",
  },
});
