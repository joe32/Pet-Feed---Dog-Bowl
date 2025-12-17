import { BleManager } from "react-native-ble-plx";

const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";

let manager = null;

export function getBleManager() {
  if (!manager) {
    manager = new BleManager();
  }
  return manager;
}

export function startScan(onDeviceFound, onError) {
  const ble = getBleManager();

  ble.startDeviceScan(
    ["4fafc201-1fb5-459e-8fcc-c5c9c331914b"], // 👈 FILTER HERE
    { allowDuplicates: false },
    (error, device) => {
      if (error) {
        if (onError) onError(error);
        return;
      }

      if (device && device.id) {
        onDeviceFound(device);
      }
    }
  );
}

export function stopScan() {
  if (manager) {
    manager.stopDeviceScan();
  }
}

export async function connectToDevice(deviceId) {
  const ble = getBleManager();

  // Connect
  const device = await ble.connectToDevice(deviceId, { autoConnect: false });

  // iOS requires service discovery or it will immediately disconnect
  await device.discoverAllServicesAndCharacteristics();

  return device;
}