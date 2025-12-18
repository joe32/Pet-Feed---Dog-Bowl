import { Platform } from "react-native";
import Constants from "expo-constants";

let socket = null;
let discoveryTimeout = null;

const isExpoGo =
  Constants.appOwnership === "expo";

export function startPetfeedDiscovery(onUpdate, onDone) {
  // 🚫 Expo Go cannot do UDP
  if (isExpoGo) {
    if (onDone) {
      setTimeout(onDone, 10000);
    }
    return;
  }

  // 👇 Native builds only (TestFlight / Dev Client)
  const dgram = require("react-native-udp");

  if (socket) return;

  const foundMap = new Map();

  socket = dgram.createSocket("udp4");

  socket.bind(41234);

  socket.on("message", (msg) => {
    try {
      const text = msg.toString();
      if (!text.startsWith("PETFEED|")) return;

      const [, host, port] = text.split("|");
      if (!host) return;

      if (!foundMap.has(host)) {
        const device = {
          id: host,
          name: host,
          host: `${host}.local`,
          port: Number(port) || 80,
          online: true,
          connection: "Local device",
        };

        foundMap.set(host, device);
        onUpdate(Array.from(foundMap.values()));
      }
    } catch {}
  });

  discoveryTimeout = setTimeout(() => {
    stopPetfeedDiscovery();
    if (onDone) onDone();
  }, 10000);
}

export function stopPetfeedDiscovery() {
  if (discoveryTimeout) {
    clearTimeout(discoveryTimeout);
    discoveryTimeout = null;
  }

  if (socket) {
    try {
      socket.close();
    } catch {}
    socket = null;
  }
}