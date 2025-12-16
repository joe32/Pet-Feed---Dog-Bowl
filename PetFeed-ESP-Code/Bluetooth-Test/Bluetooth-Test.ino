/*
  PetFeed BLE pairing sketch
  - iOS compatible
  - Pair handshake: APP sends "PAIR" → ESP replies "ACK"
  - Ready to integrate into feeder firmware later
*/

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>

// UUIDs (DO NOT CHANGE – app depends on these)
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;

bool deviceConnected = false;

// ---- Server callbacks ----
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    deviceConnected = true;
    Serial.println("📱 Phone connected");
  }

  void onDisconnect(BLEServer* server) override {
    deviceConnected = false;
    Serial.println("📴 Phone disconnected");

    // Restart advertising so app can reconnect
    BLEDevice::startAdvertising();
  }
};

// ---- Characteristic callbacks ----
class CharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    std::string value = characteristic->getValue();

    if (value.length() == 0) return;

    Serial.print("✉️ Received from app: ");
    Serial.println(value.c_str());

    // Only acknowledge valid pairing request
    if (value == "PAIR") {
      Serial.println("✅ Pair request accepted");

      characteristic->setValue("ACK");
      characteristic->notify();
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(1000);

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
  delay(1000);
}