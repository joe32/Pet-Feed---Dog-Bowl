import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";


export default function DevicesScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: "center",
        justifyContent: "flex-start",
      }}
    >
      <View>
        <Text style={[styles.title, { color: colors.text }]}>Devices</Text>
      </View>
      <View
        style={{
          flex: 1,
          width: "100%",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
      >
        <Text style={[styles.title, { color: colors.text, marginBottom: 12 }]}>
          No devices
        </Text>

        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 16,
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          Add a pet feeder to get started
        </Text>

        <TouchableOpacity
          onPress={() => router.push("/(device-setup)/add-device")}
          style={{
            backgroundColor: colors.tint,
            paddingVertical: 14,
            paddingHorizontal: 24,
            borderRadius: 14,
          }}
        >
          <Text
            style={{
              color: colors.onPrimary,
              fontSize: 16,
              fontWeight: "600",
            }}
          >
            Add Device
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 32,
    fontWeight: "600",
  },
});
