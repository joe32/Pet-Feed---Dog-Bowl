import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from "react-native";
import { useColorScheme } from "react-native";
import { useState, useRef, useEffect } from "react";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  initBle,
  startScan,
  stopScan,
  connectToDevice,
  sendWifiCredentials,
  subscribeToBleMessages,
} from "../ble/bleManager";

// Helper to generate a random hostname
function generateHostname() {
  const suffix = Math.floor(10000 + Math.random() * 90000);
  return `petfeeder-${suffix}`;
}

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

  // Wi‑Fi step state
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [wifiNetworks, setWifiNetworks] = useState([]);
  const [manualSsid, setManualSsid] = useState(false);
  const [loadingWifi, setLoadingWifi] = useState(false);
  const [wifiTimedOut, setWifiTimedOut] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [wifiScanStarted, setWifiScanStarted] = useState(false);

  // TEMP – force Wi-Fi popup + fake networks (REMOVE LATER)

  // useEffect(() => {
  //   setSetupStep("wifi");
  //   setWifiScanStarted(true);
  //   setLoadingWifi(false);
  //   setWifiTimedOut(false);
  //   setWifiNetworks([
  //     "Home_WiFi",
  //     "PetFeeder_2G",
  //     "BT-Hub-123",
  //     "iPhone Hotspot",
  //     "Guest Network",
  //   ]);
  // }, []);
  // (REMOVED: auto-start Wi-Fi scan when modal appears)

  // TEMP: force connection mode popup on load (REMOVE AFTER TESTING)
  // useEffect(() => {
  //   setSetupStep("mode");
  // }, []);

  async function scanWifiNetworks() {
    // Bump sequence so older scans are ignored
    const seq = ++wifiScanSeqRef.current;
    wifiActiveSeqRef.current = seq;

    // Clear any previous timers / aborts
    if (wifiUiTimeoutRef.current) {
      clearTimeout(wifiUiTimeoutRef.current);
      wifiUiTimeoutRef.current = null;
    }
    try {
      if (wifiAbortRef.current) {
        wifiAbortRef.current.abort();
        wifiAbortRef.current = null;
      }
    } catch {}

    setWifiScanStarted(true);
    setLoadingWifi(true);
    setWifiTimedOut(false);
    setWifiNetworks([]);

    // BLE-based Wi-Fi scan request
    console.log("scanWifiNetworks: requesting scan via BLE");
    try {
      await sendWifiCredentials("WIFISCAN");
    } catch (e) {
      console.log("scanWifiNetworks: BLE request failed", e?.message || e);
    }

    // HARD UI TIMEOUT — this MUST always fire after 10s
    wifiUiTimeoutRef.current = setTimeout(() => {
      if (wifiActiveSeqRef.current !== seq) return;
      console.log("scanWifiNetworks: HARD TIMEOUT");
      try {
        if (wifiAbortRef.current) wifiAbortRef.current.abort();
      } catch {}
      safeSet(() => {
        setLoadingWifi(false);
        setWifiTimedOut(true);
      });
    }, 10000);
  }

  // Track the generated hostname during setup
  const [generatedHost, setGeneratedHost] = useState(null);

  const timeoutRef = useRef(null);
  const wifiScanSeqRef = useRef(0);
  const wifiUiTimeoutRef = useRef(null);
  const wifiAbortRef = useRef(null);
  const wifiActiveSeqRef = useRef(0);

  // Android-only: prevent setState after unmount / during navigation (can crash on some devices)
  const isMountedRef = useRef(true);
  const androidNavigatingRef = useRef(false);
  const safeSet = (fn) => {
    if (
      Platform.OS === "android" &&
      (!isMountedRef.current || androidNavigatingRef.current)
    )
      return;
    fn();
  };

  useEffect(() => {
    return () => {
      isMountedRef.current = false;

      stopScan();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (wifiUiTimeoutRef.current) {
        clearTimeout(wifiUiTimeoutRef.current);
        wifiUiTimeoutRef.current = null;
      }
      try {
        if (wifiAbortRef.current) {
          wifiAbortRef.current.abort();
          wifiAbortRef.current = null;
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    // Pre-initialise BLE so the first scan works reliably
    try {
      initBle();
    } catch (e) {
      console.log("BLE init skipped / not available:", e);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToBleMessages((msg) => {
      if (typeof msg !== "string") return;

      // Expecting WIFI_SCAN results like: WIFI_SCAN:net1,net2,net3
      if (msg.startsWith("WIFI_SCAN:")) {
        console.log("BLE WIFI_SCAN result:", msg);

        const list = msg.replace("WIFI_SCAN:", "").trim();
        const networks = list
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        safeSet(() => {
          setWifiNetworks(networks);
          setLoadingWifi(false);
          setWifiTimedOut(false);
        });
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
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
        safeSet(() => {
          setDevices((prev) => {
            if (prev.find((d) => d.id === device.id)) return prev;
            return [...prev, device];
          });
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
  function androidCleanupBeforeNavigate() {
    if (Platform.OS !== "android") return;

    androidNavigatingRef.current = true;

    try {
      stopScan();
    } catch {}

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (wifiUiTimeoutRef.current) {
      clearTimeout(wifiUiTimeoutRef.current);
      wifiUiTimeoutRef.current = null;
    }

    try {
      if (wifiAbortRef.current) {
        wifiAbortRef.current.abort();
        wifiAbortRef.current = null;
      }
    } catch {}
  }

  async function saveDeviceAndReturn(device, name, mode, ssidParam) {
    const savedRaw = await AsyncStorage.getItem(STORAGE_KEY);
    const saved = savedRaw ? JSON.parse(savedRaw) : [];

    const updated = [
      ...saved.filter((d) => d.id !== device.id),
      {
        id: device.id,
        name,
        mode,
        host: generatedHost,
        hostname: `${generatedHost}.local`,
        ...(mode === "Wi‑Fi (local)" && ssidParam ? { ssid: ssidParam } : {}),
      },
    ];

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    await AsyncStorage.setItem(LAST_CONNECTED_KEY, device.id);

    androidCleanupBeforeNavigate();

    if (Platform.OS === "android") {
      setTimeout(() => {
        router.replace("/devices");
      }, 0);
      return;
    }

    router.replace("/devices");
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      {setupStep === null && (
        <Pressable
          onPress={() => router.push("manual-setup")}
          style={{
            position: "absolute",
            top: 12,
            right: 16,
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.textSecondary + "55",
            backgroundColor: scheme === "dark" ? "#0b1220" : "#ffffffcc",
            zIndex: 10,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              color: colors.textSecondary,
              fontWeight: "600",
            }}
          >
            Add existing device
          </Text>
        </Pressable>
      )}
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
            <Text style={[styles.buttonText, { color: colors.background }]}>
              Start scanning
            </Text>
          )}
        </TouchableOpacity>

        {!scanning && timedOut && devices.length === 0 && (
          <Text
            style={[
              styles.subtitle,
              { color: colors.textSecondary, marginTop: 24 },
            ]}
          >
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
                  style={[
                    styles.connectButton,
                    {
                      borderColor: colors.tint,
                      opacity: connectingId ? 0.6 : 1,
                    },
                  ]}
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
                      const host = generateHostname();
                      setGeneratedHost(host);
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
                    <View
                      style={{ flexDirection: "row", alignItems: "center" }}
                    >
                      <ActivityIndicator size="small" color={colors.tint} />
                      <Text
                        style={[
                          styles.connectText,
                          { color: colors.tint, marginLeft: 8 },
                        ]}
                      >
                        Connecting
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.connectText, { color: colors.tint }]}>
                      Connect
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      {setupStep === "name" && (
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={80}
            style={{ width: "100%", alignItems: "center" }}
          >
            <View
              style={[styles.modal, { backgroundColor: colors.background }]}
            >
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
          </KeyboardAvoidingView>
        </View>
      )}

      {setupStep === "mode" && (
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={80}
            style={{ width: "100%", alignItems: "center" }}
          >
            <View
              style={[styles.modal, { backgroundColor: colors.background }]}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Choose connection type
              </Text>
              {[
                { key: "wifi", label: "Wi‑Fi (local)", enabled: true },
                {
                  key: "cloud",
                  label: "Cloud (control from anywhere) - Coming soon",
                  enabled: false,
                },
              ].map((option) => (
                <TouchableOpacity
                  key={option.key}
                  disabled={!option.enabled}
                  onPress={() => setConnectionMode(option.key)}
                  style={[
                    styles.modeRow,
                    {
                      opacity: option.enabled ? 1 : 0.4,
                      borderColor:
                        connectionMode === option.key
                          ? colors.tint
                          : "#00000022",
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
                    backgroundColor: connectionMode ? colors.tint : "#999",
                    marginTop: 12,
                  },
                ]}
                disabled={!connectionMode}
                onPress={() => {
                  console.log("[SETUP] Connection mode selected:", connectionMode);

                  // Persist chosen connection mode for later steps
                  setConnectionMode(connectionMode);

                  // Continue to Wi‑Fi setup for BOTH modes
                  setSetupStep("wifi");
                  scanWifiNetworks();
                }}
              >
                <Text style={{ color: colors.background, fontWeight: "600" }}>
                  Next
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}

      {setupStep === "wifi" && (
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={80}
            style={{ width: "100%", alignItems: "center" }}
          >
            <View
              style={[styles.modal, { backgroundColor: colors.background }]}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Connect feeder to Wi‑Fi
              </Text>
              <Text
                style={[
                  styles.subtitle,
                  { color: colors.textSecondary, marginBottom: 18 },
                ]}
              >
                Enter your home Wi‑Fi details to connect your feeder to your
                network.
              </Text>

              {/* Wi-Fi networks list container */}
              <View
                style={[
                  styles.wifiListBox,
                  {
                    backgroundColor: scheme === "dark" ? "#0f172a" : "#fafbfc",
                    borderColor: scheme === "dark" ? "#ffffff22" : "#00000022",
                  },
                ]}
              >
                {!wifiScanStarted && (
                  <TouchableOpacity
                    onPress={scanWifiNetworks}
                    style={{
                      backgroundColor:
                        scheme === "dark" ? "#1f2933" : colors.tint,
                      paddingVertical: 10,
                      paddingHorizontal: 18,
                      borderRadius: 10,
                      borderWidth: scheme === "dark" ? 1 : 0,
                      borderColor:
                        scheme === "dark" ? colors.tint : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        color:
                          scheme === "dark" ? colors.tint : colors.background,
                        fontWeight: "600",
                        fontSize: 16,
                      }}
                    >
                      Search for local networks
                    </Text>
                  </TouchableOpacity>
                )}

                {wifiScanStarted && loadingWifi && (
                  <View
                    style={[
                      styles.wifiSpinnerCorner,
                      {
                        backgroundColor:
                          scheme === "dark" ? "#1f2937" : "#ffffff",
                      },
                    ]}
                  >
                    <ActivityIndicator
                      size="small"
                      color={scheme === "dark" ? "#ffffff" : colors.tint}
                    />
                  </View>
                )}
                {wifiScanStarted && wifiTimedOut && (
                  <TouchableOpacity
                    onPress={() => {
                      setWifiTimedOut(false);
                      setWifiNetworks([]);
                      scanWifiNetworks();
                    }}
                    style={[
                      styles.wifiRescanCorner,
                      {
                        backgroundColor:
                          scheme === "dark" ? "#0b1220" : "#ffffffee",
                        borderColor:
                          scheme === "dark" ? "#ffffff33" : "#00000022",
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: scheme === "dark" ? "#ffffff" : colors.tint,
                        fontWeight: "600",
                        fontSize: 12,
                      }}
                    >
                      Re-scan
                    </Text>
                  </TouchableOpacity>
                )}

                {wifiScanStarted && !loadingWifi && wifiNetworks.length > 0 && (
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingVertical: 0 }}
                    showsVerticalScrollIndicator={true}
                  >
                    {wifiNetworks.map((net) => (
                      <TouchableOpacity
                        key={net}
                        style={[
                          styles.modeRow,
                          {
                            borderColor:
                              ssid === net ? colors.tint : "#00000022",
                            marginTop: 0,
                            marginBottom: 0,
                          },
                        ]}
                        onPress={() => {
                          setSsid(net);
                          setManualSsid(true);
                        }}
                      >
                        <Text style={{ color: colors.text }}>{net}</Text>
                        {ssid === net && (
                          <Text style={{ color: colors.tint }}>✓</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {wifiScanStarted &&
                  wifiTimedOut &&
                  wifiNetworks.length === 0 && (
                    <View style={styles.wifiNoNetworksBox}>
                      <Text
                        style={{
                          color: colors.textSecondary,
                          fontSize: 16,
                          textAlign: "center",
                        }}
                      >
                        No networks found
                      </Text>
                    </View>
                  )}
              </View>

              {/* Wi-Fi actions row: Re-scan and Enter manually */}
              <View style={styles.wifiActionsRow}>
                {wifiTimedOut === true && (
                  <TouchableOpacity
                    onPress={() => {
                      setWifiScanStarted(false);
                      setWifiNetworks([]);
                      setWifiTimedOut(false);
                    }}
                    style={styles.wifiRescanButton}
                  >
                    <Text
                      style={{
                        color: colors.tint,
                        fontWeight: "600",
                        fontSize: 14,
                      }}
                    >
                      Re‑scan networks
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={() => setManualSsid(true)}
                  style={styles.wifiManualButton}
                >
                  <Text style={{ color: colors.tint, fontWeight: "600" }}>
                    Enter manually
                  </Text>
                </TouchableOpacity>
              </View>

              {/* SSID input (only shown when manual or after selecting a network) */}
              {manualSsid && (
                <TextInput
                  value={ssid}
                  onChangeText={setSsid}
                  style={[
                    styles.input,
                    {
                      color: colors.text,
                      borderColor: colors.tint,
                      marginBottom: 12,
                    },
                  ]}
                  placeholder="Wi‑Fi name (SSID)"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!rebooting}
                />
              )}

              <TextInput
                value={password}
                onChangeText={setPassword}
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    borderColor: colors.tint,
                    marginBottom: 18,
                  },
                ]}
                placeholder="Wi‑Fi password"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!rebooting}
              />
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  {
                    backgroundColor: ssid ? colors.tint : "#999",
                  },
                ]}
                disabled={!ssid || rebooting}
                onPress={async () => {
                  if (rebooting) return;

                  setRebooting(true);

                  try {
                    const modeToSend = connectionMode === "cloud" ? "cloud" : "wifi";

                    console.log("[SETUP] Sending provisioning payload to ESP:", {
                      ssid,
                      host: generatedHost,
                      mode: modeToSend,
                    });

                    await sendWifiCredentials(
                      `WIFI:ssid=${ssid};pass=${password};host=${generatedHost};mode=${modeToSend}`
                    );
                  } catch (e) {
                    console.log("BLE ended after Wi‑Fi write (expected):", e);
                  }

                  // Give ESP time to reboot before navigation
                  await new Promise((r) => setTimeout(r, 300));

                  const finalMode = connectionMode === "cloud" ? "Cloud" : "Wi‑Fi (local)";
                  console.log("[SETUP] Final device mode being saved:", finalMode);

                  await saveDeviceAndReturn(
                    pendingDevice,
                    deviceName,
                    finalMode,
                    ssid
                  );
                }}
              >
                {rebooting ? (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <ActivityIndicator color={colors.background} />
                    <Text
                      style={{
                        color: colors.background,
                        fontWeight: "600",
                        marginLeft: 10,
                      }}
                    >
                      Rebooting…
                    </Text>
                  </View>
                ) : (
                  <Text style={{ color: colors.background, fontWeight: "600" }}>
                    Save & Continue
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
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
    justifyContent: "flex-start",
    paddingTop: 20,
    alignItems: "center",
  },
  modal: {
    width: "90%",
    maxWidth: 420,
    borderRadius: 16,
    padding: 20,
    paddingBottom: 28,
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
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 6,
  },
  // --- Wi-Fi step additions ---
  wifiScanningSection: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    marginTop: 0,
  },
  wifiListBox: {
    height: 90,
    minHeight: 90,
    maxHeight: 90,
    width: "100%",
    borderWidth: 1,
    borderColor: "#00000022",
    borderRadius: 14,
    marginBottom: 12,
    backgroundColor: "#fafbfc",
    overflow: "hidden",
    paddingHorizontal: 6,
    justifyContent: "center",
  },
  wifiNoNetworksBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    width: "100%",
  },
  wifiRescanButton: {
    alignSelf: "center",
    marginBottom: 10,
    marginTop: 0,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  wifiManualButton: {
    alignSelf: "center",
    marginBottom: 8,
    marginTop: 0,
  },
  wifiActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginBottom: 8,
  },
  wifiSpinnerCorner: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 10,
    padding: 4,
    borderRadius: 10,
    // backgroundColor added dynamically in render for dark/light mode
  },
  wifiRescanCorner: {
    position: "absolute",
    bottom: 6,
    right: 6,
    zIndex: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
});
