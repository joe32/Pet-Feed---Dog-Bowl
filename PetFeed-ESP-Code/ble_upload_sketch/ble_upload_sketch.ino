#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLECharacteristic *pCharacteristic = nullptr;

void setup() {
  Serial.begin(115200);
  delay(800);

  // Hard reset BLE stack (important on ESP32-S3 when state gets weird)
  BLEDevice::deinit(true);
  delay(200);

  BLEDevice::init("PetFeeder123");

  BLEServer *server = BLEDevice::createServer();
  BLEService *service = server->createService(SERVICE_UUID);

  pCharacteristic = service->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_NOTIFY
  );

  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setValue("READY");

  service->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->stop();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->start();

  Serial.println("Advertising: PetFeeder123");
  Serial.println("Service UUID: " SERVICE_UUID);
  Serial.println("Characteristic UUID: " CHARACTERISTIC_UUID);
}

void loop() {
  delay(1000);
}