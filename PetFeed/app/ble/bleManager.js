import { BleManager } from "react-native-ble-plx";
import { Platform } from "react-native";

const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";

let manager = null;
let connectedDevice = null;
let connectionListeners = [];

export function getBleManager() {
  if (!manager) {
    manager = new BleManager();
  }
  return manager;
}

/* -------------------- CONNECTION STATE -------------------- */

function notifyConnectionChange() {
  connectionListeners.forEach((cb) => cb(connectedDevice));
}

export function subscribeToConnectionChanges(cb) {
  connectionListeners.push(cb);
  cb(connectedDevice); // immediately emit current state

  return () => {
    connectionListeners = connectionListeners.filter((c) => c !== cb);
  };
}

export function getConnectedDevice() {
  return connectedDevice;
}

/* -------------------- SCANNING -------------------- */

export function startScan(onDeviceFound, onError) {
  const ble = getBleManager();

  ble.startDeviceScan(
    [SERVICE_UUID], // FILTER: only PetFeed devices
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

/* -------------------- CONNECT / DISCONNECT -------------------- */

export async function connectToDevice(deviceId) {
  const ble = getBleManager();

  // If already connected to something else, disconnect first
  if (connectedDevice && connectedDevice.id !== deviceId) {
    try {
      await disconnectFromDevice();
    } catch {}
  }

  const device = await ble.connectToDevice(deviceId, {
    autoConnect: false,
    requestMTU: Platform.OS === "android" ? 185 : undefined,
  });

  await device.discoverAllServicesAndCharacteristics();

  // Monitor disconnects (power off, app close, etc)
  device.onDisconnected(() => {
    connectedDevice = null;
    notifyConnectionChange();
  });

  connectedDevice = device;
  notifyConnectionChange();

  return device;
}

export async function disconnectFromDevice() {
  if (!connectedDevice) return;

  const ble = getBleManager();
  const id = connectedDevice.id;

  connectedDevice = null;
  notifyConnectionChange();

  try {
    await ble.cancelDeviceConnection(id);
  } catch {
    // already disconnected
  }
}

/* -------------------- CLEANUP -------------------- */

export function destroyBleManager() {
  if (manager) {
    manager.destroy();
    manager = null;
    connectedDevice = null;
    connectionListeners = [];
  }
}