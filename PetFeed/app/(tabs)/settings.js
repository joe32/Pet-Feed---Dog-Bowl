import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function SettingsScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  const confirmClearDevices = () => {
    Alert.alert(
      "Clear all devices",
      "This will remove all saved devices from this app. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            // TODO: also disconnect BLE devices here later
            await AsyncStorage.removeItem("devices");
          },
        },
      ]
    );
  };

  const confirmClearAppData = () => {
    Alert.alert(
      "Clear all app data",
      "This will reset the app to its default state. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
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
    paddingHorizontal: 16,
    paddingTop: 16,
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
