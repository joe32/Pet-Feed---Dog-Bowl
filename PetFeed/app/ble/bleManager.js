import { BleManager } from "react-native-ble-plx";

const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

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

export async function connectToDevice(deviceId) {
  const ble = getBleManager();

  const device = await ble.connectToDevice(deviceId, { autoConnect: false });
  await device.discoverAllServicesAndCharacteristics();
  return device;
}

export async function pairWithDevice(deviceId) {
  const ble = getBleManager();

  const device = await ble.devices([deviceId]).then(d => d[0]);
  if (!device) return false;

  const characteristic = await device.writeCharacteristicWithResponseForService(
    SERVICE_UUID,
    CHARACTERISTIC_UUID,
    Buffer.from("PAIR").toString("base64")
  );

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);

    device.monitorCharacteristicForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      (error, char) => {
        if (error || !char?.value) return;

        const value = Buffer.from(char.value, "base64").toString("utf8");
        if (value === "ACK") {
          clearTimeout(timeout);
          resolve(true);
        }
      }
    );
  });
}