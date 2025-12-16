import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";

export default function AddDeviceScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

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
            { backgroundColor: colors.tint },
          ]}
          onPress={() => {}}
        >
          <Text
            style={[
              styles.buttonText,
              { color: colors.background },
            ]}
          >
            Start scanning
          </Text>
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
});