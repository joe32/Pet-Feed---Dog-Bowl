import { View, Text, StyleSheet } from "react-native";
import { useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors } from "../../constants/theme";

export default function ScheduleScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.center}>
        <Text style={[styles.title, { color: colors.text }]}>
          Schedule
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    alignItems: "center",
    justifyContent: "flex-start",
  },
  title: {
    fontSize: 32,
    fontWeight: "600",
  },
});