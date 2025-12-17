import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert, TextInput } from "react-native";
import { useColorScheme } from "react-native";
import { useState, useRef, useEffect } from "react";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { startScan, stopScan, connectToDevice, sendWifiCredentials } from "../ble/bleManager";

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
  const [connectedId, setConnectedId] = useState(null);

  // null | "name" | "mode" | "wifi"
  const [setupStep, setSetupStep] = useState(null);
  const [pendingDevice, setPendingDevice] = useState(null);
  const [deviceName, setDeviceName] = useState("");
  // "wifi" | "cloud"
  const [connectionMode, setConnectionMode] = useState(null);

  // Wi-Fi step state
  const [wifiStep, setWifiStep] = useState(false);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");

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
    }, 5000);
  }

  async function saveDeviceAndReturn(device, name, mode, ssidParam) {
    const savedRaw = await AsyncStorage.getItem(STORAGE_KEY);
    const saved = savedRaw ? JSON.parse(savedRaw) : [];

    const updated = [
      ...saved.filter(d => d.id !== device.id),
      {
        id: device.id,
        name,
        mode,
        ...(mode === "Wi‑Fi (local)" && ssidParam ? { ssid: ssidParam } : {}),
      },
    ];

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    await AsyncStorage.setItem(LAST_CONNECTED_KEY, device.id);

    router.replace("/devices");
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

                      // Connect + discover services (this is the real "handshake")
                      await connectToDevice(item.id);

                      // Stop scanning cleanly
                      stopScan();
                      if (timeoutRef.current) {
                        clearTimeout(timeoutRef.current);
                        timeoutRef.current = null;
                      }

                      setScanning(false);
                      setTimedOut(false);
                      setConnectedId(item.id);
                      setPendingDevice(item);
                      setDeviceName(item.name || "Pet Feeder");
                      setSetupStep("name");

                    } catch (e) {
                      console.log("Connect failed:", e);
                      Alert.alert(
                        "Couldn’t connect",
                        "Make sure the feeder is powered on and nearby, then try again."
                      );
                      setConnectingId(null);
                    }
                  }}
                  disabled={!!connectingId}
                >
                  {connectedId === item.id ? (
                    <Text style={[styles.connectText, { color: "#3ddc84" }]}>
                      ✓ Connected
                    </Text>
                  ) : connectingId === item.id ? (
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

      {setupStep === "name" && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Name your feeder
            </Text>

            <TextInput
              value={deviceName}
              onChangeText={setDeviceName}
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.tint },
              ]}
            />

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.tint }]}
              onPress={() => setSetupStep("mode")}
            >
              <Text style={{ color: colors.background, fontWeight: "600" }}>
                Next
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {setupStep === "mode" && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Choose connection type
            </Text>
            {[
              { key: "wifi", label: "Wi‑Fi (local)", enabled: true },
              { key: "cloud", label: "Cloud (control from anywhere)", enabled: false },
            ].map(option => (
              <TouchableOpacity
                key={option.key}
                disabled={!option.enabled}
                onPress={() => setConnectionMode(option.key)}
                style={[
                  styles.modeRow,
                  {
                    opacity: option.enabled ? 1 : 0.4,
                    borderColor:
                      connectionMode === option.key ? colors.tint : "#00000022",
                  },
                ]}
              >
                <Text style={{ color: colors.text }}>{option.label}</Text>
                {connectionMode === option.key && (
                  <Text style={{ color: colors.tint }}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[
                styles.modalButton,
                {
                  backgroundColor:
                    connectionMode === "wifi" ? colors.tint : "#999",
                  marginTop: 12,
                },
              ]}
              disabled={connectionMode !== "wifi"}
              onPress={() => {
                if (connectionMode === "wifi") {
                  setSetupStep("wifi");
                }
              }}
            >
              <Text style={{ color: colors.background, fontWeight: "600" }}>
                Next
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {setupStep === "wifi" && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Connect feeder to Wi‑Fi
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary, marginBottom: 18 }]}>
              Enter your home Wi‑Fi details to connect your feeder to your network.
            </Text>
            <TextInput
              value={ssid}
              onChangeText={setSsid}
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.tint, marginBottom: 12 },
              ]}
              placeholder="Wi‑Fi name (SSID)"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.tint, marginBottom: 18 },
              ]}
              placeholder="Wi‑Fi password"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TouchableOpacity
              style={[
                styles.modalButton,
                {
                  backgroundColor: ssid ? colors.tint : "#999",
                },
              ]}
              disabled={!ssid}
              onPress={async () => {
                try {
                  // Send Wi‑Fi credentials to ESP over BLE
                  await sendWifiCredentials(ssid, password);

                  // Persist device locally (do NOT store password)
                  await saveDeviceAndReturn(
                    pendingDevice,
                    deviceName,
                    "Wi‑Fi (local)",
                    ssid
                  );
                } catch (e) {
                  Alert.alert(
                    "Setup failed",
                    "Could not send Wi‑Fi details to the feeder. Make sure it is still connected and try again."
                  );
                }
              }}
            >
              <Text style={{ color: colors.background, fontWeight: "600" }}>
                Save & Continue
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#00000066",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    width: "90%",
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  modalButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  modeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 10,
  },
});