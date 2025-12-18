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
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <WiFiUdp.h>

// ================= BLE =================
#define SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLEServer *pServer = nullptr;
BLECharacteristic *pCharacteristic = nullptr;
bool deviceConnected = false;

// ================= STORAGE =================
Preferences prefs;

// ================= WIFI / HTTP =================
WebServer server(80);
String wifiSSID = "";
String wifiPASS = "";
String mdnsHost = "";
String deviceMode = "ble";

WiFiUDP discoveryUdp;
const uint16_t DISCOVERY_PORT = 4210;
unsigned long lastDiscoveryBroadcast = 0;

// ================= WIFI SCAN STATE =================
unsigned long wifiScanStart = 0;
bool wifiScanActive = false;
String lastWifiScanResult = "";

// ================= TIME =================
int lastPrintedMinute = -1;
int lastPrintedHour = -1;

bool hasSchedule = false;
int scheduledHour = -1;
int scheduledMinute = -1;
bool scheduleExecutedToday = false;

void setUKTimezone()
{
  setenv("TZ", "GMT0BST,M3.5.0/1,M10.5.0/2", 1);
  tzset();
}

void performWifiScan(bool verboseSerial)
{
  Serial.println("📡 Starting Wi‑Fi scan");
  int n = WiFi.scanNetworks(/*async=*/false, /*hidden=*/true);
  lastWifiScanResult = "";

  if (n <= 0)
  {
    Serial.println("⚠️ No Wi‑Fi networks found");
    return;
  }

  for (int i = 0; i < n; i++)
  {
    lastWifiScanResult += WiFi.SSID(i);
    if (i < n - 1)
      lastWifiScanResult += ",";
  }

  if (verboseSerial)
  {
    Serial.print("📶 Networks found: ");
    Serial.println(lastWifiScanResult);
  }
}

// ================= SERVO =================
Servo myServo;
const int servoPin = 6; // KEEP GPIO 6
const int LID_OPEN = 0;
const int LID_CLOSED = 120;

bool lidIsOpen = false;
int currentAngle = LID_CLOSED;

// ================= BUZZER =================
const int buzzerPin = 5;
const int buzzerChannel = 7;
const int buzzerResolution = 8;

void toneOn(int freq)
{
  ledcWriteTone(buzzerChannel, freq);
}

void toneOff()
{
  ledcWriteTone(buzzerChannel, 0);
}

void beep(int freq, int durationMs)
{
  toneOn(freq);
  delay(durationMs);
  toneOff();
}

void clickBeep()
{
  beep(1800, 40);
}

void confirmBeep()
{
  beep(1200, 120);
  delay(80);
  beep(1600, 160);
}

void scheduledFeedBeep()
{
  // Long repeating tone to alert a scheduled feed
  for (int i = 0; i < 6; i++)
  {
    toneOn(1400);
    delay(350);
    toneOff();
    delay(250);
  }
}

// ================= HELPER: NOTIFY LID STATE =================
void notifyLidState()
{
  if (!pCharacteristic)
    return;

  String state = lidIsOpen ? "STATE:OPEN" : "STATE:CLOSED";
  pCharacteristic->setValue(state.c_str());
  pCharacteristic->notify();

  Serial.print("📤 Sent lid state: ");
  Serial.println(state);
}

// ================= HELPER: SAVE/LOAD SCHEDULE =================
void saveSchedule()
{
  prefs.begin("petfeed", false);
  prefs.putBool("hasSchedule", hasSchedule);
  prefs.putInt("schHour", scheduledHour);
  prefs.putInt("schMin", scheduledMinute);
  prefs.end();
}

void loadSchedule()
{
  prefs.begin("petfeed", true);
  hasSchedule = prefs.getBool("hasSchedule", false);
  scheduledHour = prefs.getInt("schHour", -1);
  scheduledMinute = prefs.getInt("schMin", -1);
  prefs.end();
}

// ================= HELPER: NOTIFY SCHEDULE =================
void notifySchedule()
{
  // NOTE: BLE notification only; app now relies on HTTP GETSCHEDULE
  if (!pCharacteristic)
    return;

  if (!hasSchedule)
  {
    pCharacteristic->setValue("SCHEDULE:NONE");
    pCharacteristic->notify();
    Serial.println("📤 Sent schedule: NONE");
    return;
  }

  char buf[32];
  sprintf(buf, "SCHEDULED:%02d:%02d", scheduledHour, scheduledMinute);
  pCharacteristic->setValue(buf);
  pCharacteristic->notify();

  Serial.print("📤 Sent schedule: ");
  Serial.println(buf);
}

// ================= SERVO MOTION =================
void servoWriteSmooth(int targetAngle)
{
  if (targetAngle == currentAngle)
    return;

  if (targetAngle < currentAngle)
  {
    for (int i = currentAngle; i >= targetAngle; i--)
    {
      myServo.write(i);
      delay(5);
    }
  }
  else
  {
    for (int i = currentAngle; i <= targetAngle; i++)
    {
      myServo.write(i);
      delay(5);
    }
  }
  currentAngle = targetAngle;
}

void moveLidOpen()
{
  if (lidIsOpen)
    return;
  Serial.println("🔓 OPEN");
  myServo.attach(servoPin);
  servoWriteSmooth(LID_OPEN);
  delay(300);
  myServo.detach();
  lidIsOpen = true;
  clickBeep();
  notifyLidState();
}

void moveLidClosed()
{
  if (!lidIsOpen)
    return;
  Serial.println("🔒 CLOSE");
  myServo.attach(servoPin);
  servoWriteSmooth(LID_CLOSED);
  delay(300);
  myServo.detach();
  lidIsOpen = false;
  clickBeep();
  notifyLidState();
}

// ================= FACTORY RESET =================
void factoryReset()
{
  Serial.println("🧨 FACTORY RESET");

  prefs.begin("petfeed", false);
  prefs.clear();
  prefs.end();

  mdnsHost = "";

  BLEDevice::deinit(true);
  delay(200);
  BLEDevice::init("PetFeeder1");

  wifiSSID = "";
  wifiPASS = "";
  deviceMode = "ble";

  BLEDevice::startAdvertising();
}

// ================= WIFI MODE =================
void startWifiMode()
{
  Serial.println("📡 Wi-Fi mode");

  BLEDevice::deinit(true);

  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSSID.c_str(), wifiPASS.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000)
  {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED)
  {
    Serial.println("❌ Wi-Fi failed");
    factoryReset();
    ESP.restart();
    return;
  }

  Serial.print("✅ IP: ");
  Serial.println(WiFi.localIP());

  discoveryUdp.begin(DISCOVERY_PORT);
  Serial.println("📡 UDP discovery started");

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  delay(1500);
  setUKTimezone();

  if (mdnsHost.length())
  {
    Serial.print("🔧 Starting mDNS with hostname: ");
    Serial.println(mdnsHost);

    if (MDNS.begin(mdnsHost.c_str()))
    {
      Serial.print("🌐 mDNS started successfully: ");
      Serial.print(mdnsHost);
      Serial.println(".local");
    }
    else
    {
      Serial.println("❌ mDNS failed to start");
    }
  }

  Serial.print("📢 Discovery identity: ");
  Serial.print(mdnsHost.length() ? mdnsHost : "petfeeder");
  Serial.println(".local");

  // OTA: enable mDNS so Arduino IDE can discover OTA
  // This does NOT replace or break our existing MDNS.begin(mdnsHost)
  ArduinoOTA.setMdnsEnabled(true);

  // Keep OTA hostname aligned with the app's hostname when provided
  if (mdnsHost.length())
  {
    ArduinoOTA.setHostname(mdnsHost.c_str());
  }
  else
  {
    ArduinoOTA.setHostname("petfeeder");
  }
  ArduinoOTA.setPassword("ota");

  ArduinoOTA.onStart([]()
                     { Serial.println("🔁 OTA update start"); });

  ArduinoOTA.onEnd([]()
                   { Serial.println("✅ OTA update complete"); });

  ArduinoOTA.onError([](ota_error_t error)
                     { Serial.printf("❌ OTA error[%u]\n", error); });

  ArduinoOTA.begin();
  Serial.println("📡 OTA ready");

  server.on("/ping", []()
            { server.send(200, "application/json", "{\"type\":\"petfeed\"}"); });

  // ================= WIFI SCAN (APP) =================
  server.on("/WIFISCAN", HTTP_GET, []()
  {
    Serial.println("📥 HTTP /WIFISCAN called");

    performWifiScan(false);

    StaticJsonDocument<512> doc;
    JsonArray arr = doc.createNestedArray("networks");

    if (lastWifiScanResult.length())
    {
      int start = 0;
      while (true)
      {
        int idx = lastWifiScanResult.indexOf(",", start);
        if (idx == -1)
        {
          arr.add(lastWifiScanResult.substring(start));
          break;
        }
        arr.add(lastWifiScanResult.substring(start, idx));
        start = idx + 1;
      }
    }

    String res;
    serializeJson(doc, res);
    server.send(200, "application/json", res);
  });

  server.on("/command", HTTP_POST, []()
            {
    if (!server.hasArg("plain")) {
      server.send(400, "text/plain", "no body");
      return;
    }

    StaticJsonDocument<200> doc;
    deserializeJson(doc, server.arg("plain"));

    String cmd = doc["command"] | "";

    if (cmd == "OPEN") moveLidOpen();
    if (cmd == "CLOSE") moveLidClosed();

    server.send(200, "application/json", "{\"status\":\"ok\"}"); });

  server.on("/factory-reset", HTTP_POST, []()
            {
    server.send(200, "text/plain", "resetting");
    delay(200);
    factoryReset();
    ESP.restart(); });

  // ================= GET LID STATE (APP) =================
  server.on("/GETSTATE", HTTP_GET, []()
            {
  StaticJsonDocument<64> doc;
  doc["state"] = lidIsOpen ? "OPEN" : "CLOSED";

  String res;
  serializeJson(doc, res);

  server.send(200, "application/json", res);

  Serial.print("📤 HTTP lid state sent: ");
  Serial.println(doc["state"].as<String>()); });

  // ================= UPDATE WIFI (APP) =================
  server.on("/update-wifi", HTTP_POST, []()
            {
    if (!server.hasArg("plain")) {
      server.send(400, "text/plain", "no body");
      return;
    }

    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, server.arg("plain"));
    if (err) {
      server.send(400, "text/plain", "invalid json");
      return;
    }

    String newSsid = doc["ssid"] | "";
    String newPass = doc["password"] | "";

    if (!newSsid.length() || !newPass.length()) {
      server.send(400, "text/plain", "missing credentials");
      return;
    }

    Serial.println("📡 Updating Wi‑Fi credentials from app");
    Serial.print("SSID: ");
    Serial.println(newSsid);
    Serial.print("PASS length: ");
    Serial.println(newPass.length());

    prefs.begin("petfeed", false);
    prefs.putString("ssid", newSsid);
    prefs.putString("pass", newPass);
    prefs.putString("mode", "wifi");
    prefs.end();

    server.send(200, "application/json", "{\"status\":\"saved\",\"reboot\":true}");

    Serial.println("🔁 Rebooting to apply new Wi‑Fi...");
    Serial.flush();
    delay(800);
    ESP.restart(); });

  // ================= GET SCHEDULE (APP) =================
  server.on("/GETSCHEDULE", HTTP_GET, []()
  {
    StaticJsonDocument<128> doc;

    if (!hasSchedule)
    {
      doc["hasSchedule"] = false;
      String res;
      serializeJson(doc, res);
      server.send(200, "application/json", res);
      Serial.println("📤 GETSCHEDULE → NONE");
      return;
    }

    doc["hasSchedule"] = true;
    doc["hour"] = scheduledHour;
    doc["minute"] = scheduledMinute;

    String res;
    serializeJson(doc, res);
    server.send(200, "application/json", res);

    Serial.print("📤 GETSCHEDULE → ");
    Serial.print(scheduledHour);
    Serial.print(":");
    Serial.println(scheduledMinute);
  });

  // ================= SCHEDULE HTTP ROUTES =================
  server.on("/SCHEDULE", HTTP_POST, []()
            {
    Serial.println("📥 HTTP /SCHEDULE called");
    if (!server.hasArg("plain")) {
      server.send(400, "text/plain", "no body");
      return;
    }

    StaticJsonDocument<128> doc;
    deserializeJson(doc, server.arg("plain"));
    String time = doc["time"] | "";
    Serial.print("📥 Scheduled time received: ");
    Serial.println(time);

    int colon = time.indexOf(":");
    if (colon < 0) {
      server.send(400, "text/plain", "invalid time");
      return;
    }

    scheduledHour = time.substring(0, colon).toInt();
    scheduledMinute = time.substring(colon + 1).toInt();
    hasSchedule = true;
    scheduleExecutedToday = false;
    moveLidClosed();  // ensure closed when scheduling
    saveSchedule();
    notifySchedule();
    confirmBeep();
    Serial.println("✅ Schedule saved successfully");
    server.send(200, "application/json", "{\"status\":\"scheduled\"}"); });

  server.on("/CANCEL_SCHEDULE", HTTP_POST, []()
            {
    Serial.println("📥 HTTP /CANCEL_SCHEDULE called");
    hasSchedule = false;
    scheduledHour = -1;
    moveLidClosed();  // ensure closed when scheduling
    scheduledMinute = -1;
    scheduleExecutedToday = false;
    saveSchedule();
    notifySchedule();
    beep(900, 120);
    Serial.println("🗑️ Schedule cancelled");
    server.send(200, "application/json", "{\"status\":\"cancelled\"}"); });

  server.begin();
}

// ================= BLE CALLBACKS =================
class ServerCallbacks : public BLEServerCallbacks
{
  void onConnect(BLEServer *) override
  {
    deviceConnected = true;
    Serial.println("📱 BLE connected");
  }
  void onDisconnect(BLEServer *) override
  {
    deviceConnected = false;
    Serial.println("📴 BLE disconnected");
    BLEDevice::startAdvertising();
  }
};

class CharacteristicCallbacks : public BLECharacteristicCallbacks
{
  void onWrite(BLECharacteristic *c) override
  {
    Serial.print("📨 BLE raw payload: ");
    Serial.println(c->getValue().c_str());

    String cmd = String(c->getValue().c_str());

    cmd.trim();

    // ================= WIFI SCAN (BLE) =================
    if (cmd == "WIFISCAN")
    {
      Serial.println("📡 BLE requested Wi‑Fi scan");

      int n = WiFi.scanNetworks();
      if (n <= 0)
      {
        c->setValue("WIFISCAN:EMPTY");
        c->notify();
        Serial.println("⚠️ No networks found");
        return;
      }

      String result = "WIFISCAN:";
      for (int i = 0; i < n; i++)
      {
        result += WiFi.SSID(i);
        if (i < n - 1)
          result += ",";
      }

      c->setValue(result.c_str());
      c->notify();

      Serial.print("📤 Sent Wi‑Fi list: ");
      Serial.println(result);
      return;
    }

    if (!cmd.startsWith("WIFI:"))
    {
      return;
    }

    wifiSSID = "";
    wifiPASS = "";
    mdnsHost = "";

    int s1 = cmd.indexOf("ssid=");
    int p1 = cmd.indexOf("pass=");
    int h1 = cmd.indexOf("host=");

    if (s1 >= 0)
    {
      int end = cmd.indexOf(";", s1);
      if (end < 0)
        end = cmd.length();
      wifiSSID = cmd.substring(s1 + 5, end);
    }

    if (p1 >= 0)
    {
      int end = cmd.indexOf(";", p1);
      if (end < 0)
        end = cmd.length();
      wifiPASS = cmd.substring(p1 + 5, end);
    }

    if (h1 >= 0)
    {
      int end = cmd.indexOf(";", h1);
      if (end < 0)
        end = cmd.length();
      mdnsHost = cmd.substring(h1 + 5, end);
    }

    // HARD GUARD: if SSID accidentally contains "WIFI:ssid=", strip it
    if (wifiSSID.startsWith("WIFI:ssid="))
    {
      wifiSSID.replace("WIFI:ssid=", "");
    }

    Serial.println("📥 Final provisioning values:");
    Serial.print("SSID: ");
    Serial.println(wifiSSID);
    Serial.print("PASS length: ");
    Serial.println(wifiPASS.length());
    Serial.print("HOST: ");
    Serial.println(mdnsHost);

    if (!wifiSSID.length() || !wifiPASS.length())
    {
      Serial.println("❌ Invalid Wi‑Fi credentials received, aborting");
      return;
    }

    prefs.begin("petfeed", false);
    prefs.putString("ssid", wifiSSID);
    prefs.putString("pass", wifiPASS);
    prefs.putString("host", mdnsHost);
    prefs.putString("mode", "wifi");
    prefs.end();

    c->setValue("WIFI_SAVED");
    c->notify();
    confirmBeep();

    Serial.println("🔁 Rebooting into Wi‑Fi mode...");
    Serial.flush();
    delay(1500);
    ESP.restart();
  }
};

// ================= SETUP =================
void setup()
{
  Serial.begin(115200);
  delay(1000);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  ledcSetup(buzzerChannel, 2000, buzzerResolution);
  ledcAttachPin(buzzerPin, buzzerChannel);
  toneOff();

  myServo.attach(servoPin);
  myServo.write(LID_CLOSED);
  delay(400);
  myServo.detach();
  lidIsOpen = false;
  currentAngle = LID_CLOSED;
  Serial.println("🔒 Lid forced closed on startup");

  prefs.begin("petfeed", true);
  deviceMode = prefs.getString("mode", "ble");
  wifiSSID = prefs.getString("ssid", "");
  wifiPASS = prefs.getString("pass", "");
  mdnsHost = prefs.getString("host", "");
  prefs.end();

  loadSchedule();

  if (deviceMode == "wifi" && wifiSSID.length())
  {
    startWifiMode();
    return;
  }

  BLEDevice::init("PetFeeder");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *service = pServer->createService(SERVICE_UUID);
  pCharacteristic = service->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new CharacteristicCallbacks());
  pCharacteristic->setValue("READY");

  service->start();
  BLEDevice::getAdvertising()->addServiceUUID(SERVICE_UUID);
  BLEDevice::startAdvertising();

  Serial.println("🔵 BLE pairing ready");
}

// ================= LOOP =================
void loop()
{
  if (Serial.available())
  {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "open")
      moveLidOpen();
    if (cmd == "close")
      moveLidClosed();
    if (cmd == "factory")
    {
      factoryReset();
      ESP.restart();
    }
    if (cmd == "network")
    {
      Serial.println("🧪 Serial Wi‑Fi scan (5s test)");
      unsigned long start = millis();
      while (millis() - start < 5000)
      {
        performWifiScan(true);
        delay(1000);
      }
    }
  }

  // Print time once per minute, exactly at :00 seconds (non-blocking)
  if (deviceMode == "wifi")
  {
    struct tm t;
    if (getLocalTime(&t))
    {
      if (t.tm_sec == 0 && (t.tm_min != lastPrintedMinute || t.tm_hour != lastPrintedHour))
      {
        lastPrintedMinute = t.tm_min;
        lastPrintedHour = t.tm_hour;
        Serial.printf("⏰ Time: %02d:%02d:%02d\n", t.tm_hour, t.tm_min, t.tm_sec);
      }

      if (hasSchedule && !scheduleExecutedToday && t.tm_hour == scheduledHour && t.tm_min == scheduledMinute)
      {

        Serial.println("🍽️ Executing scheduled feed");
        scheduledFeedBeep();
        moveLidOpen();
        scheduleExecutedToday = true;
      }

      // Reset daily execution flag at midnight
      if (t.tm_hour == 0 && t.tm_min == 0 && t.tm_sec == 0)
      {
        scheduleExecutedToday = false;
      }
    }
  }

  if (deviceMode == "wifi")
  {
    server.handleClient();
  }

  if (deviceMode == "wifi")
  {
    ArduinoOTA.handle();
  }

  if (deviceMode == "wifi" && millis() - lastDiscoveryBroadcast > 3000) {
    lastDiscoveryBroadcast = millis();

    String host = mdnsHost.length() ? mdnsHost : "petfeeder";
    String payload = "PETFEED|" + host + "|80";

    discoveryUdp.beginPacket("255.255.255.255", DISCOVERY_PORT);
    discoveryUdp.print(payload);
    discoveryUdp.endPacket();

    Serial.print("📢 UDP broadcast: ");
    Serial.println(payload);
  }

  delay(50);
}