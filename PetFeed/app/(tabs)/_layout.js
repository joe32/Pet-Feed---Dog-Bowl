import { Platform, Image, useColorScheme } from "react-native";
import { Tabs } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";

export default function TabLayout() {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  // iOS: keep native tabs (what you already had working)
  if (Platform.OS === "ios") {
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="index">
          <Icon sf="arcade.stick" />
          <Label>Control</Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="schedule">
          <Icon sf="alarm" />
          <Label>Schedule</Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="devices">
          <Icon sf="macbook.and.iphone" />
          <Label>Devices</Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="settings">
          <Icon sf="gearshape" />
          <Label>Settings</Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  // Android: use standard Tabs (NativeTabs is broken on Android)
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Control",
          tabBarIcon: ({ focused }) => (
            <Image
              source={require("../../assets/images/tabIcons/joystick.png")}
              style={{
                width: 25,
                height: 25,
                tintColor: focused
                  ? isDark
                    ? "#ffffff"
                    : "#000000"
                  : isDark
                  ? "rgba(255,255,255,0.45)"
                  : "rgba(0,0,0,0.45)",
              }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: "Schedule",
          tabBarIcon: ({ focused }) => (
            <Image
              source={require("../../assets/images/tabIcons/alarm.png")}
              style={{
                width: 25,
                height: 25,
                tintColor: focused
                  ? isDark
                    ? "#ffffff"
                    : "#000000"
                  : isDark
                  ? "rgba(255,255,255,0.45)"
                  : "rgba(0,0,0,0.45)",
              }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="devices"
        options={{
          title: "Devices",
          tabBarIcon: ({ focused }) => (
            <Image
              source={require("../../assets/images/tabIcons/devices.png")}
              style={{
                width: 25,
                height: 25,
                tintColor: focused
                  ? isDark
                    ? "#ffffff"
                    : "#000000"
                  : isDark
                  ? "rgba(255,255,255,0.45)"
                  : "rgba(0,0,0,0.45)",
              }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ focused }) => (
            <Image
              source={require("../../assets/images/tabIcons/settings.png")}
              style={{
                width: 25,
                height: 25,
                tintColor: focused
                  ? isDark
                    ? "#ffffff"
                    : "#000000"
                  : isDark
                  ? "rgba(255,255,255,0.45)"
                  : "rgba(0,0,0,0.45)",
              }}
            />
          ),
        }}
      />
    </Tabs>
  );
}
