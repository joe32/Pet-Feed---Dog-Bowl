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

  // 1. Connect to device
  const device = await ble.connectToDevice(deviceId, { autoConnect: false });

  // 2. REQUIRED on iOS: discover services & characteristics
  await device.discoverAllServicesAndCharacteristics();

  // 3. Ensure service & characteristic exist (prevents iOS auto-disconnect)
  const services = await device.services();
  const service = services.find(s => s.uuid.toLowerCase() === SERVICE_UUID);

  if (!service) {
    throw new Error("Service not found");
  }

  const characteristics = await service.characteristics();
  const characteristic = characteristics.find(
    c => c.uuid.toLowerCase() === CHARACTERISTIC_UUID
  );

  if (!characteristic) {
    throw new Error("Characteristic not found");
  }

  // 4. Send PAIR command
  await device.writeCharacteristicWithResponseForService(
    SERVICE_UUID,
    CHARACTERISTIC_UUID,
    Buffer.from("PAIR").toString("base64")
  );

  // 5. Wait for ACK response
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Pairing timeout"));
    }, 5000);

    device.monitorCharacteristicForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      (error, char) => {
        if (error || !char?.value) return;

        const value = Buffer.from(char.value, "base64").toString("utf8");

        if (value === "ACK") {
          clearTimeout(timeout);
          resolve(device);
        }
      }
    );
  });
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