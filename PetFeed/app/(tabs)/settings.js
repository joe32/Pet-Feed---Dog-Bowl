import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function SettingsScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  const factoryResetAllDevices = async () => {
    try {
      const raw = await AsyncStorage.getItem("PETFEED_DEVICES");
      const devices = raw ? JSON.parse(raw) : [];

      for (const device of devices) {
        if (device.ip) {
          try {
            await fetch(`http://${device.ip}/factory-reset`, { method: "POST" });
          } catch (e) {
            // Device may be offline; ignore and continue
          }
        }
      }
    } catch (e) {
      // Ignore – best effort reset
    }
  };

  const confirmClearDevices = () => {
    Alert.alert(
      "Clear saved devices",
      "Do you want to just remove devices from this app, or also factory reset the devices themselves?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove from app only",
          style: "default",
          onPress: async () => {
            await AsyncStorage.removeItem("PETFEED_DEVICES");
            await AsyncStorage.removeItem("PETFEED_ACTIVE_DEVICE");
          },
        },
        {
          text: "Factory reset devices",
          style: "destructive",
          onPress: async () => {
            await factoryResetAllDevices();
            await AsyncStorage.removeItem("PETFEED_DEVICES");
            await AsyncStorage.removeItem("PETFEED_ACTIVE_DEVICE");
          },
        },
      ]
    );
  };

  const confirmClearAppData = () => {
    Alert.alert(
      "Clear all app data",
      "This will factory reset all devices and completely reset the app. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear everything",
          style: "destructive",
          onPress: async () => {
            await factoryResetAllDevices();
            await AsyncStorage.clear();
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: "center",
        justifyContent: "flex-start",
      }}
    >
      <View style={styles.section}>
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>

        <TouchableOpacity style={styles.row} onPress={confirmClearDevices}>
          <Text style={[styles.rowText, { color: colors.text }]}>
            Clear saved devices
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={confirmClearAppData}>
          <Text style={[styles.rowText, { color: "#ff453a" }]}>
            Clear all app data
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  section: {
    width: "100%",
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: "600",
    marginBottom: 24,
  },
  row: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2c2c2e",
  },
  rowText: {
    fontSize: 16,
  },
});
