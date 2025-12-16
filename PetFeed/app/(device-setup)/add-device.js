import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useColorScheme } from "react-native";
import { useState } from "react";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActivityIndicator } from "react-native";

export default function AddDeviceScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];
  const [scanning, setScanning] = useState(false);

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
          onPress={() => setScanning(true)}
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
});