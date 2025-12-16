import { View, Text, TouchableOpacity, StyleSheet, FlatList } from "react-native";
import { useColorScheme } from "react-native";
import { useState, useRef } from "react";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActivityIndicator } from "react-native";
import { startScan, stopScan } from "../ble/bleManager";

export default function AddDeviceScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState([]);
  const [timedOut, setTimedOut] = useState(false);

  const timeoutRef = useRef(null);

  function beginScan() {
    setDevices([]);
    setTimedOut(false);
    setScanning(true);

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

    timeoutRef.current = setTimeout(() => {
      stopScan();
      setScanning(false);
      setTimedOut(true);
    }, 10000);
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
                <TouchableOpacity style={[styles.connectButton, { borderColor: colors.tint }]}>
                  <Text style={[styles.connectText, { color: colors.tint }]}>
                    Connect
                  </Text>
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