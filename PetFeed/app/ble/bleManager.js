import { BleManager } from "react-native-ble-plx";

let manager = null;

export function getBleManager() {
  if (!manager) {
    manager = new BleManager();
  }
  return manager;
}

export function startScan(onDeviceFound, onError) {
  const ble = getBleManager();

  ble.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
    if (error) {
      if (onError) onError(error);
      return;
    }

    if (device && device.id) {
      onDeviceFound(device);
    }
  });
}

export function stopScan() {
  if (manager) {
    manager.stopDeviceScan();
  }
}