import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, RefreshControl, ScrollView } from "react-native";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  connectToDevice as bleConnect,
  disconnectFromDevice,
  getConnectedDevice,
  subscribeToConnectionChanges,
} from "../ble/bleManager";

const STORAGE_KEY = "PETFEED_DEVICES";
const LAST_CONNECTED_KEY = "PETFEED_LAST_CONNECTED";

export default function DevicesScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  const [devices, setDevices] = useState([]);
  const [connectingId, setConnectingId] = useState(null);
  const [connectedId, setConnectedId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    React.useCallback(() => {
      const unsubscribe = subscribeToConnectionChanges((device) => {
        if (device) {
          setConnectedId(device.id);
          AsyncStorage.setItem(LAST_CONNECTED_KEY, device.id);
        } else {
          setConnectedId(null);
          AsyncStorage.removeItem(LAST_CONNECTED_KEY);
        }
      });

      loadDevices();

      return () => {
        if (unsubscribe) unsubscribe();
      };
    }, [])
  );

  async function loadDevices() {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    setDevices(parsed);

    const connected = getConnectedDevice();
    if (connected && parsed.find(d => d.id === connected.id)) {
      setConnectedId(connected.id);
    } else {
      setConnectedId(null);
    }
  }

  async function refreshDevices() {
    setRefreshing(true);
    await loadDevices();
    setRefreshing(false);
  }

  async function saveDevices(updated) {
    setDevices(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  async function handleDevicePress(device) {
    if (connectedId === device.id) {
      Alert.alert(
        "Disconnect?",
        `Disconnect from "${device.name}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disconnect",
            style: "destructive",
            onPress: async () => {
              await disconnectFromDevice();
            },
          },
        ]
      );
      return;
    }

    if (connectedId && connectedId !== device.id) {
      Alert.alert(
        "Switch device?",
        `Disconnect from the current device and connect to "${device.name}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Connect",
            style: "destructive",
            onPress: () => startConnect(device),
          },
        ]
      );
    } else {
      startConnect(device);
    }
  }

  async function startConnect(device) {
    try {
      setConnectingId(device.id);
      await bleConnect(device.id);
    } catch (e) {
      Alert.alert("Connection failed", "Could not connect to device.");
    } finally {
      setConnectingId(null);
    }
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
            const updated = devices.filter(d => d.id !== device.id);
            await saveDevices(updated);

            if (connectedId === device.id) {
              setConnectedId(null);
              await AsyncStorage.removeItem(LAST_CONNECTED_KEY);
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

  function renderDevice(device) {
    const isConnected = connectedId === device.id;
    const isConnecting = connectingId === device.id;

    return (
      <TouchableOpacity
        key={device.id}
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
                backgroundColor: isConnected ? "#3ddc84" : "#777",
              }}
            />
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
              {isConnecting
                ? "Connecting…"
                : isConnected
                ? "Connected"
                : "Not connected"}
            </Text>
          </View>
        </View>

        {isConnecting ? (
          <ActivityIndicator />
        ) : (
          <TouchableOpacity
            onPress={() =>
              Alert.alert("Device options", device.name, [
                { text: "Rename", onPress: () => renameDevice(device) },
                { text: "Remove", style: "destructive", onPress: () => removeDevice(device) },
                { text: "Cancel", style: "cancel" },
              ])
            }
          >
            <Text style={{ fontSize: 22, color: colors.textSecondary }}>⚙︎</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  }

  return (
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
});
