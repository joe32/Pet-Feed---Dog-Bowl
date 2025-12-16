import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert } from "react-native";
import { useColorScheme } from "react-native";
import { useState, useRef, useEffect } from "react";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { startScan, stopScan, connectToDevice, pairWithDevice } from "../ble/bleManager";

const STORAGE_KEY = "PETFEED_DEVICES";
const LAST_CONNECTED_KEY = "PETFEED_LAST_CONNECTED";

export default function AddDeviceScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];
  const router = useRouter();

  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState([]);
  const [timedOut, setTimedOut] = useState(false);
  const [connectingId, setConnectingId] = useState(null);

  const timeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      stopScan();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  async function beginScan() {
    if (scanning) return;

    // Ensure any previous scan is fully stopped
    stopScan();
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setDevices([]);
    setTimedOut(false);
    setScanning(true);

    // iOS BLE warm-up: first scan after permissions often returns empty
    await new Promise((resolve) => setTimeout(resolve, 500));

    startScan(
      (device) => {
        setDevices((prev) => {
          if (prev.find((d) => d.id === device.id)) return prev;
          return [...prev, device];
        });
      },
      (error) => {
        console.log("BLE scan error:", error);
      }
    );

    // This is the final timeout; devices are shown live as discovered.
    timeoutRef.current = setTimeout(() => {
      stopScan();
      setScanning(false);
      setTimedOut(true);
    }, 10000);
  }

  async function saveDeviceAndReturn(device) {
    const name = device?.name || "PetFeed";

    const savedRaw = await AsyncStorage.getItem(STORAGE_KEY);
    const saved = savedRaw ? JSON.parse(savedRaw) : [];

    const exists = saved.some((d) => d.id === device.id);
    const updated = exists
      ? saved.map((d) => (d.id === device.id ? { ...d, name } : d))
      : [...saved, { id: device.id, name }];

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    await AsyncStorage.setItem(LAST_CONNECTED_KEY, device.id);

    router.back();
  }

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: colors.background },
      ]}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>
          Find nearby feeder
        </Text>

        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Make sure your feeder is powered on and nearby
        </Text>

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.tint, opacity: scanning ? 0.6 : 1 },
          ]}
          onPress={beginScan}
          disabled={scanning}
        >
          {scanning ? (
            <View style={styles.scanningRow}>
              <Text
                style={[
                  styles.buttonText,
                  { color: colors.background, marginRight: 10 },
                ]}
              >
                Scanning
              </Text>
              <ActivityIndicator color={colors.background} />
            </View>
          ) : (
            <Text
              style={[
                styles.buttonText,
                { color: colors.background },
              ]}
            >
              Start scanning
            </Text>
          )}
        </TouchableOpacity>

        {!scanning && timedOut && devices.length === 0 && (
          <Text style={[styles.subtitle, { color: colors.textSecondary, marginTop: 24 }]}>
            No devices found
          </Text>
        )}

        {devices.length > 0 && (
          <FlatList
            style={{ marginTop: 24, width: "100%" }}
            data={devices}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.deviceRow}>
                <Text style={[styles.deviceName, { color: colors.text }]}>
                  {item.name || "Unknown device"}
                </Text>
                <TouchableOpacity
                  style={[styles.connectButton, { borderColor: colors.tint, opacity: connectingId ? 0.6 : 1 }]}
                  onPress={async () => {
                    if (connectingId) return;

                    try {
                      setConnectingId(item.id);
                      await connectToDevice(item.id);
                      const paired = await pairWithDevice(item.id);
                      if (!paired) {
                        throw new Error("Pairing failed");
                      }
                      stopScan();
                      if (timeoutRef.current) {
                        clearTimeout(timeoutRef.current);
                        timeoutRef.current = null;
                      }
                      setScanning(false);
                      setTimedOut(false);
                      await saveDeviceAndReturn(item);
                    } catch (e) {
                      console.log("Connect failed:", e);
                      Alert.alert("Couldn’t connect", "Make sure the feeder is on and nearby, then try again.");
                    } finally {
                      setConnectingId(null);
                    }
                  }}
                  disabled={!!connectingId}
                >
                  {connectingId === item.id ? (
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <ActivityIndicator size="small" color={colors.tint} />
                      <Text style={[styles.connectText, { color: colors.tint, marginLeft: 8 }]}>
                        Connecting
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.connectText, { color: colors.tint }]}>Connect</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 32,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  scanningRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: "#00000022",
  },
  deviceName: {
    fontSize: 16,
  },
  connectButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  connectText: {
    fontSize: 14,
    fontWeight: "600",
  },
});