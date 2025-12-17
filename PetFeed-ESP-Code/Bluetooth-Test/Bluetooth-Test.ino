/*
  PetFeed firmware
  - BLE pairing
  - Wi-Fi provisioning
  - HTTP control (OPEN / CLOSE)
  - Servo + buzzer
  - Time sync (UK)
*/

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#include <time.h>
#include <ArduinoJson.h>

// ================= BLE =================
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
bool deviceConnected = false;

// ================= STORAGE =================
Preferences prefs;

// ================= WIFI / HTTP =================
WebServer server(80);
String wifiSSID = "";
String wifiPASS = "";
String deviceMode = "ble";

// ================= TIME =================
unsigned long lastTimePrint = 0;
const unsigned long TIME_PRINT_INTERVAL = 10000;

void setUKTimezone() {
  setenv("TZ", "GMT0BST,M3.5.0/1,M10.5.0/2", 1);
  tzset();
}

// ================= SERVO =================
Servo myServo;
const int servoPin = 6;   // KEEP GPIO 6
const int LID_OPEN = 0;
const int LID_CLOSED = 120;

bool lidIsOpen = false;
int currentAngle = LID_CLOSED;

// ================= BUZZER =================
const int buzzerPin = 5;
const int buzzerChannel = 7;
const int buzzerResolution = 8;

void toneOn(int freq) {
  ledcWriteTone(buzzerChannel, freq);
}

void toneOff() {
  ledcWriteTone(buzzerChannel, 0);
}

void beep(int freq, int durationMs) {
  toneOn(freq);
  delay(durationMs);
  toneOff();
}

void clickBeep() {
  beep(1800, 40);
}

void confirmBeep() {
  beep(1200, 120);
  delay(80);
  beep(1600, 160);
}

// ================= SERVO MOTION =================
void servoWriteSmooth(int targetAngle) {
  if (targetAngle == currentAngle) return;

  if (targetAngle < currentAngle) {
    for (int i = currentAngle; i >= targetAngle; i--) {
      myServo.write(i);
      delay(1);
    }
  } else {
    for (int i = currentAngle; i <= targetAngle; i++) {
      myServo.write(i);
      delay(5);
    }
  }
  currentAngle = targetAngle;
}

void moveLidOpen() {
  if (lidIsOpen) return;
  Serial.println("🔓 OPEN");
  myServo.attach(servoPin);
  servoWriteSmooth(LID_OPEN);
  delay(300);
  myServo.detach();
  lidIsOpen = true;
  clickBeep();
}

void moveLidClosed() {
  if (!lidIsOpen) return;
  Serial.println("🔒 CLOSE");
  myServo.attach(servoPin);
  servoWriteSmooth(LID_CLOSED);
  delay(300);
  myServo.detach();
  lidIsOpen = false;
  clickBeep();
}

// ================= FACTORY RESET =================
void factoryReset() {
  Serial.println("🧨 FACTORY RESET");

  prefs.begin("petfeed", false);
  prefs.clear();
  prefs.end();

  BLEDevice::deinit(true);
  delay(200);
  BLEDevice::init("PetFeed-Test");

  wifiSSID = "";
  wifiPASS = "";
  deviceMode = "ble";

  BLEDevice::startAdvertising();
}

// ================= WIFI MODE =================
void startWifiMode() {
  Serial.println("📡 Wi-Fi mode");

  BLEDevice::deinit(true);

  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSSID.c_str(), wifiPASS.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ Wi-Fi failed");
    factoryReset();
    ESP.restart();
    return;
  }

  Serial.print("✅ IP: ");
  Serial.println(WiFi.localIP());

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  delay(1500);
  setUKTimezone();

  server.on("/ping", []() {
    server.send(200, "application/json", "{\"type\":\"petfeed\"}");
  });

  server.on("/command", HTTP_POST, []() {
    if (!server.hasArg("plain")) {
      server.send(400, "text/plain", "no body");
      return;
    }

    StaticJsonDocument<200> doc;
    deserializeJson(doc, server.arg("plain"));

    String cmd = doc["command"] | "";

    if (cmd == "OPEN") moveLidOpen();
    if (cmd == "CLOSE") moveLidClosed();

    server.send(200, "application/json", "{\"status\":\"ok\"}");
  });

  server.on("/factory-reset", HTTP_POST, []() {
    server.send(200, "text/plain", "resetting");
    delay(200);
    factoryReset();
    ESP.restart();
  });

  server.begin();
}

// ================= BLE CALLBACKS =================
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    deviceConnected = true;
    Serial.println("📱 BLE connected");
  }
  void onDisconnect(BLEServer*) override {
    deviceConnected = false;
    Serial.println("📴 BLE disconnected");
    BLEDevice::startAdvertising();
  }
};

class CharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String cmd = String(c->getValue().c_str());

    if (cmd.startsWith("WIFI:")) {
      int s = cmd.indexOf("ssid=");
      int p = cmd.indexOf(";pass=");
      wifiSSID = cmd.substring(s + 5, p);
      wifiPASS = cmd.substring(p + 6);

      prefs.begin("petfeed", false);
      prefs.putString("ssid", wifiSSID);
      prefs.putString("pass", wifiPASS);
      prefs.putString("mode", "wifi");
      prefs.end();

      c->setValue("WIFI_SAVED");
      c->notify();
      confirmBeep();
      ESP.restart();
    }
  }
};

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  ledcSetup(buzzerChannel, 2000, buzzerResolution);
  ledcAttachPin(buzzerPin, buzzerChannel);
  toneOff();

  prefs.begin("petfeed", true);
  deviceMode = prefs.getString("mode", "ble");
  wifiSSID = prefs.getString("ssid", "");
  wifiPASS = prefs.getString("pass", "");
  prefs.end();

  if (deviceMode == "wifi" && wifiSSID.length()) {
    startWifiMode();
    return;
  }

  BLEDevice::init("PetFeed-Test");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* service = pServer->createService(SERVICE_UUID);
  pCharacteristic = service->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new CharacteristicCallbacks());
  pCharacteristic->setValue("READY");/Users/joewilson/Documents/Pet Feed - Dog Bowl/PetFeed-ESP-Code/PetFeed-ESP-Code.ino

  service->start();
  BLEDevice::getAdvertising()->addServiceUUID(SERVICE_UUID);
  BLEDevice::startAdvertising();

  Serial.println("🔵 BLE pairing ready");
}

// ================= LOOP =================
void loop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "open") moveLidOpen();
    if (cmd == "close") moveLidClosed();
    if (cmd == "factory") {
      factoryReset();
      ESP.restart();
    }
  }

  if (deviceMode == "wifi" && millis() - lastTimePrint > TIME_PRINT_INTERVAL) {
    lastTimePrint = millis();
    struct tm t;
    if (getLocalTime(&t)) {
      Serial.printf("⏰ Time: %02d:%02d:%02d\n", t.tm_hour, t.tm_min, t.tm_sec);
    }
  }

  if (deviceMode == "wifi") {
    server.handleClient();
  }

  delay(50);
}