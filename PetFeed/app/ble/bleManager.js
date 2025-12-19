import { BleManager } from "react-native-ble-plx";
import { Platform } from "react-native";
import { Buffer } from "buffer";

let bleState = "Unknown";
let stateListeners = [];

const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const WIFI_CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
const CLAIM_SERVICE_UUID = "9b3a9f10-2c2e-4b6f-9f6a-9b4f5e7c1111";
const CLAIM_CHARACTERISTIC_UUID = "9b3a9f10-2c2e-4b6f-9f6a-9b4f5e7c2222";

let manager = null;
let scanMode = "default"; // "default" | "claim"
let connectedDevice = null;
let connectionListeners = [];

export function getBleManager() {
  if (!manager) {
    manager = new BleManager();

    manager.onStateChange((state) => {
      bleState = state;
      stateListeners.forEach((cb) => cb(state));
    }, true);
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

export function setBleScanMode(mode) {
  scanMode = mode === "claim" ? "claim" : "default";
}

export async function startScan(onDeviceFound, onError) {
  const ble = getBleManager();

  try {
    await waitForBlePoweredOn();
  } catch (e) {
    if (onError) onError(e);
    return;
  }

  const serviceFilter =
    scanMode === "claim" ? [CLAIM_SERVICE_UUID] : [SERVICE_UUID];

  ble.startDeviceScan(
    serviceFilter, // FILTER: only PetFeed devices
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

  await device.services();

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

export async function sendWifiCredentials(ssid, password) {
  if (!connectedDevice) {
    throw new Error("No device connected");
  }

  const serviceUuid =
    scanMode === "claim" ? CLAIM_SERVICE_UUID : SERVICE_UUID;
  const charUuid =
    scanMode === "claim" ? CLAIM_CHARACTERISTIC_UUID : WIFI_CHAR_UUID;

  const base64Payload = Buffer.from(ssid, "utf8").toString("base64");

  await connectedDevice.writeCharacteristicWithResponseForService(
    serviceUuid,
    charUuid,
    base64Payload
  );
}

export async function sendClaimCommand() {
  if (!connectedDevice) {
    throw new Error("No device connected");
  }

  // Force claim mode UUIDs regardless of current scan mode
  const serviceUuid = CLAIM_SERVICE_UUID;
  const charUuid = CLAIM_CHARACTERISTIC_UUID;

  // Write "CLAIM" to ESP
  const base64Payload = Buffer.from("CLAIM", "utf8").toString("base64");

  const characteristic =
    await connectedDevice.writeCharacteristicWithResponseForService(
      serviceUuid,
      charUuid,
      base64Payload
    );

  // Read back the notified / updated value (HOST:<hostname>)
  const readChar =
    await connectedDevice.readCharacteristicForService(
      serviceUuid,
      charUuid
    );

  const decoded = Buffer.from(readChar.value, "base64")
    .toString("utf8")
    .trim();

  return decoded; // expected format: "HOST:petfeeder-12345"
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

export function initBle() {
  getBleManager();
}

export function getBleState() {
  return bleState;
}

export function waitForBlePoweredOn(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (bleState === "PoweredOn") {
      resolve();
      return;
    }

    const start = Date.now();

    const unsub = subscribeToBleState((state) => {
      if (state === "PoweredOn") {
        unsub();
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        unsub();
        reject(new Error("Bluetooth not powered on"));
      }
    });
  });
}

function subscribeToBleState(cb) {
  stateListeners.push(cb);
  cb(bleState);

  return () => {
    stateListeners = stateListeners.filter((c) => c !== cb);
  };
}