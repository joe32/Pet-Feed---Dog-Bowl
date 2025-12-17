/*
  PetFeed BLE pairing sketch
  - iOS compatible
  - Pair handshake: APP sends "PAIR" → ESP replies "ACK"
  - Ready to integrate into feeder firmware later
*/

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WebServer.h>

// UUIDs (DO NOT CHANGE – app depends on these)
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;

bool deviceConnected = false;

Preferences prefs;
WebServer server(80);

String wifiSSID = "";
String wifiPASS = "";
String deviceMode = "ble"; // "ble" or "wifi"

void factoryReset() {
  Serial.println("🧨 FACTORY RESET STARTED");

  prefs.begin("petfeed", false);
  prefs.clear();
  prefs.end();

  // Ensure BLE stack is re-initialized after reset
  BLEDevice::deinit(true);
  delay(200);
  BLEDevice::init("PetFeed-Test");

  wifiSSID = "";
  wifiPASS = "";
  deviceMode = "ble";

  if (pServer) {
    pServer->disconnect(0);
  }

  BLEDevice::startAdvertising();
  deviceMode = "ble";

  Serial.println("✅ Factory reset complete (BLE mode restored)");
}

void startWifiMode() {
  Serial.println("📡 Starting Wi-Fi mode");

  // Fully disable BLE before switching to Wi-Fi
  BLEDevice::deinit(true);

  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSSID.c_str(), wifiPASS.c_str());

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(500);
    yield();
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ Wi-Fi failed, reverting to BLE mode");
    factoryReset();
    ESP.restart();
    return;
  }

  Serial.print("✅ Wi-Fi connected, IP: ");
  Serial.println(WiFi.localIP());
  deviceMode = "wifi";

  server.on("/ping", []() {
    server.send(
      200,
      "application/json",
      "{\"type\":\"petfeed\",\"model\":\"pf-1\",\"fw\":\"1.0\"}"
    );
  });
  server.on("/hello", []() {
    Serial.println("Hello");
    server.send(200, "text/plain", "ok");
  });
  server.on("/factory-reset", HTTP_POST, []() {
    Serial.println("🧨 FACTORY RESET REQUESTED FROM APP");
    server.send(200, "text/plain", "resetting");
    delay(200);
    factoryReset();
    ESP.restart();
  });
  server.begin();

  Serial.println("🌐 Local HTTP server started");
}

// ---- Server callbacks ----
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    deviceConnected = true;
    Serial.println("📱 Phone connected");
    if (pCharacteristic) {
      pCharacteristic->setValue("CONNECTED");
      pCharacteristic->notify();
    }
  }

  void onDisconnect(BLEServer* server) override {
    deviceConnected = false;
    Serial.println("📴 Phone disconnected");

    BLEDevice::startAdvertising();
  }
};

class CharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    std::string value = characteristic->getValue();
    String cmd = String(value.c_str());

    if (cmd.startsWith("WIFI:")) {
      int s = cmd.indexOf("ssid=");
      int p = cmd.indexOf(";pass=");

      if (s >= 0 && p >= 0) {
        wifiSSID = cmd.substring(s + 5, p);
        wifiPASS = cmd.substring(p + 6);

        prefs.begin("petfeed", false);
        prefs.putString("ssid", wifiSSID);
        prefs.putString("pass", wifiPASS);
        prefs.putString("mode", "wifi");
        prefs.end();

        characteristic->setValue("WIFI_SAVED");
        characteristic->notify();

        Serial.println("💾 Wi-Fi credentials saved, rebooting");
        Serial.println(wifiSSID);
        Serial.println(wifiPASS);
        delay(300);
        ESP.restart();
      }
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("🔁 Booting PetFeed firmware");

  prefs.begin("petfeed", true);
  deviceMode = prefs.getString("mode", "ble");
  wifiSSID = prefs.getString("ssid", "");
  wifiPASS = prefs.getString("pass", "");
  prefs.end();

  if (deviceMode == "wifi" && wifiSSID.length() > 0) {
    startWifiMode();
    return;
  }

  Serial.println("🔵 Starting PetFeed BLE pairing");

  BLEDevice::init("PetFeed-Test");

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new CharacteristicCallbacks());

  pCharacteristic->setValue("READY");

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);

  // Required for stable iOS connections
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);

  BLEDevice::startAdvertising();

  Serial.println("✅ Advertising as PetFeed-Test");
  Serial.println("👉 Waiting for app pairing");
}

void loop() {
  // Always allow serial factory reset, regardless of mode
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd.equalsIgnoreCase("factory")) {
      factoryReset();
      ESP.restart();
      return;
    }
  }

  // If running in Wi‑Fi mode, keep HTTP server alive
  if (deviceMode == "wifi") {
    server.handleClient();
  }

  delay(50);
}