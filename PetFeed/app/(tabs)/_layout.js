import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";

export default function TabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf="house.fill" />
        <Label>Home</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="devices">
        <Icon sf="dot.radiowaves.left.and.right" />
        <Label>Devices</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}