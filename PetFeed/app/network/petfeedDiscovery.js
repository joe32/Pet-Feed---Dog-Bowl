import { NativeModules, Platform } from "react-native";
import { BleManager } from "react-native-ble-plx";
import { Buffer } from "buffer";

const CLAIM_SERVICE_UUID = "9b3a9f10-2c2e-4b6f-9f6a-9b4f5e7c1111";
const CLAIM_CHARACTERISTIC_UUID = "9b3a9f10-2c2e-4b6f-9f6a-9b4f5e7c2222";

let manager = null;
let scanTimeout = null;

export function startPetfeedDiscovery(onUpdate, onDone) {
  if (!manager) {
    // Guard for Expo Go / environments without native BLE
    if (!NativeModules.BleManager || Platform.OS === "web") {
      // BLE not available, fail silently
      if (onDone) onDone();
      return;
    }

    manager = new BleManager();
  }

  const foundMap = new Map();

  manager.startDeviceScan(
    [CLAIM_SERVICE_UUID],
    { allowDuplicates: false },
    async (error, device) => {
      if (error || !device) return;

      try {
        const connected = await device.connect();
        const discovered = await connected.discoverAllServicesAndCharacteristics();

        const services = await discovered.services();
        const claimService = services.find(
          (s) => s.uuid.toLowerCase() === CLAIM_SERVICE_UUID.toLowerCase()
        );
        if (!claimService) return;

        const chars = await claimService.characteristics();
        const claimChar = chars.find(
          (c) => c.uuid.toLowerCase() === CLAIM_CHARACTERISTIC_UUID.toLowerCase()
        );
        if (!claimChar) return;

        await claimChar.writeWithResponse(
          Buffer.from("CLAIM").toString("base64")
        );

        const value = await claimChar.read();
        const decoded = Buffer.from(value.value, "base64").toString("utf8");

        if (!decoded.startsWith("HOST:")) return;

        const host = decoded.replace("HOST:", "").trim();
        if (foundMap.has(host)) return;

        const deviceObj = {
          id: host,
          name: host,
          host: `${host}.local`,
          online: true,
          connection: "Local device",
        };

        foundMap.set(host, deviceObj);
        onUpdate(Array.from(foundMap.values()));

        await connected.cancelConnection();
      } catch {}
    }
  );

  scanTimeout = setTimeout(() => {
    stopPetfeedDiscovery();
    if (onDone) onDone();
  }, 10000);
}

export function stopPetfeedDiscovery() {
  if (scanTimeout) {
    clearTimeout(scanTimeout);
    scanTimeout = null;
  }

  if (manager) {
    try {
      manager.stopDeviceScan();
    } catch {}
  }
}