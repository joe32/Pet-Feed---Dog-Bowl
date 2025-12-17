import React, { useEffect, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, RefreshControl, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Swipeable, GestureHandlerRootView } from "react-native-gesture-handler";

const STORAGE_KEY = "PETFEED_DEVICES";
const ACTIVE_DEVICE_KEY = "PETFEED_ACTIVE_DEVICE";

async function pingHost(host) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://${host}.local/ping`, { signal: controller.signal });
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

  const loadDevices = useCallback(async () => {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const active = await AsyncStorage.getItem(ACTIVE_DEVICE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    const normalised = parsed.map(d => ({
      ...d,
      mode: d.mode || "wifi",
      online: typeof d.online === "boolean" ? d.online : false,
    }));
    setDevices(normalised);
    setActiveDeviceId(active);
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    const id = setInterval(async () => {
      if (devices.length === 0) return;
      const updated = await Promise.all(
        devices.map(async d => {
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
      devices.map(async d => {
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
                await fetch(`http://${device.host}.local/factory-reset`, { method: "POST" });
              } catch {}
            }
            const updated = devices.filter(d => d.id !== device.id);
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
        <TouchableOpacity
          onPress={() => selectDevice(device)}
          style={[styles.card, { backgroundColor: colors.card }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.deviceName, { color: colors.text }]}>{device.name}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
              {isActive ? "Selected" : "Not selected"} · {device.online ? "Online" : "Offline"}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
              Connection: Wi‑Fi (local)
            </Text>
          </View>

          <View style={styles.inlineActions}>
            <TouchableOpacity onPress={() => Alert.alert("Rename coming soon")}>
              <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => removeDevice(device)} style={{ marginLeft: 12 }}>
              <Ionicons name="trash-outline" size={22} color="#ff3b30" />
            </TouchableOpacity>
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
          <TouchableOpacity onPress={() => router.push("/(device-setup)/add-device")}>
            <Text style={{ color: colors.tint, fontSize: 16 }}>Add Device +</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1, paddingHorizontal: 24 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />
          }
        >
          {devices.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.title, { color: colors.text }]}>No devices</Text>
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
});
