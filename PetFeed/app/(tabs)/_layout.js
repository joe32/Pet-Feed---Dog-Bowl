import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";

export default function TabLayout() {
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
