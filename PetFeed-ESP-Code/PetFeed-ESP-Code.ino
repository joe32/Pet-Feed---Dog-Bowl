#include <vector>
/*
  PetFeed firmware
  - BLE pairing
  - Wi-Fi provisioning
  - HTTP control (OPEN / CLOSE)
  - Servo + buzzer
  - Time sync (UK)
*/

// NOTE:
// BLE is ONLY active during initial setup (BLE mode).
// When deviceMode == "wifi", BLE is fully disabled to avoid Wi‑Fi instability.

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
#include <HTTPClient.h>
#include <SPIFFS.h>
#include <Update.h>

#define FW_VERSION "1.4.4"
#define FIRMWARE_DIR "/fw"

String latestBinName = "";
String latestVersionName = "";

// ===== CHECK-UPDATE RESULT STATE =====
String checkUpdateResult = "unknown"; // unknown | up_to_date | update_available | error
String checkUpdateLatest = "";

// ===== AUTO UPDATE RESULT STATE (SEPARATE FROM MANUAL) =====
String autoCheckResult = "unknown";   // unknown | up_to_date | update_available | error
String autoCheckLatest = "";

// ===== APP OTA STATUS =====
String otaStatus = "idle";  // idle | checking | downloading | installing | done | error
String otaProgress = "";    // e.g. "0.42/1.56 MB"
String otaMessage = "";     // human-readable status

bool otaRequested = false;
bool otaRunning = false;
TaskHandle_t otaTaskHandle = nullptr;
TaskHandle_t serverTaskHandle = nullptr;

// ===== CHECK-UPDATE GUARD =====
bool checkUpdateRunning = false;
TaskHandle_t checkUpdateTaskHandle = nullptr;

// ===== AUTO UPDATE PREFS =====
// Defaults: auto updates ON, preferred time 00:01 (12:01am)
bool autoUpdateEnabled = true;
int preferredUpdateHour = 0;
int preferredUpdateMinute = 1;

// automatic update timing (TESTING = 1 minute)
unsigned long lastAutoUpdateCheckMs = 0;
const unsigned long AUTO_UPDATE_INTERVAL_MS = 60000;

// scheduling state
bool autoUpdateScheduled = false;
int scheduledUpdateHour = -1;
int scheduledUpdateMinute = -1;
int scheduledUpdateDayOfYear = -1;   // day-of-year the schedule is intended for
bool autoUpdateStarted = false;      // prevents double-start within the same minute

// If an auto update attempt fails, we want to be able to reschedule and try again
unsigned long lastAutoUpdateAttemptMs = 0;
const unsigned long AUTO_UPDATE_RETRY_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

void clearAutoUpdateSchedule(const char *reason) {
  if (autoUpdateScheduled || scheduledUpdateHour != -1 || scheduledUpdateMinute != -1) {
    Serial.print("🧹 AUTO UPDATE: clearing schedule (");
    Serial.print(reason);
    Serial.println(")");
  }
  autoUpdateScheduled = false;
  scheduledUpdateHour = -1;
  scheduledUpdateMinute = -1;
  scheduledUpdateDayOfYear = -1;
  autoUpdateStarted = false;
}

// auto-check task coordination
bool autoUpdateCheckPending = false;
unsigned long autoUpdateCheckStartedMs = 0;

// Track SPIFFS mount state (some environments fail if you call begin() in multiple places)
bool spiffsMounted = false;

bool ensureSPIFFS() {
  if (spiffsMounted)
    return true;

  if (!SPIFFS.begin(false)) {
    Serial.println("❌ SPIFFS mount failed");
    spiffsMounted = false;
    return false;
  }

  spiffsMounted = true;

  if (!SPIFFS.exists(FIRMWARE_DIR)) {
    SPIFFS.mkdir(FIRMWARE_DIR);
  }
  if (!SPIFFS.exists(FIRMWARE_DIR)) {
    Serial.println("❌ Failed to create firmware directory");
    return false;
  }

  return true;
}
// Helper: Reopen and rewind firmware directory
void reopenFirmwareDir(File &root) {
  if (root)
    root.close();
  root = SPIFFS.open(FIRMWARE_DIR);
  if (root)
    root.rewindDirectory();
}

// ======= Firmware file enumerator =======
int collectFirmwareFiles(std::vector<String> &out) {
  out.clear();
  if (!ensureSPIFFS())
    return 0;

  File root = SPIFFS.open(FIRMWARE_DIR);
  if (!root || !root.isDirectory()) {
    if (root)
      root.close();
    return 0;
  }
  root.rewindDirectory();
  while (true) {
    File f = root.openNextFile();
    if (!f)
      break;
    if (!f.isDirectory()) {
      String full = String(FIRMWARE_DIR) + "/" + String(f.name()).substring(String(f.name()).lastIndexOf('/') + 1);
      out.push_back(full);
    }
    f.close();
  }
  root.close();
  return out.size();
}

// ================= FIRMWARE SPIFFS HELPERS =================
void listDownloadedFirmware() {
  if (!ensureSPIFFS()) {
    Serial.println("❌ SPIFFS not mounted");
    return;
  }
  std::vector<String> files;
  int count = collectFirmwareFiles(files);

  if (count == 0) {
    Serial.println("No downloaded firmware found");
    return;
  }

  Serial.println("Downloaded firmware:");
  for (int i = 0; i < files.size(); i++) {
    File f = SPIFFS.open(files[i]);
    if (!f)
      continue;

    String name = files[i];
    if (name.startsWith(FIRMWARE_DIR "/")) {
      name.remove(0, strlen(FIRMWARE_DIR) + 1);
    }

    Serial.printf("%d. %s (%d bytes)\n",
                  i + 1, name.c_str(), f.size());
    f.close();
  }
}

// ====== FIRMWARE DELETE HELPERS ======
bool deleteAllFirmware() {
  if (!ensureSPIFFS())
    return false;
  std::vector<String> files;
  int count = collectFirmwareFiles(files);
  if (count == 0) {
    Serial.println("No downloaded firmware found");
    return false;
  }
  for (auto &p : files) {
    bool ok = SPIFFS.remove(p);
    Serial.println(ok ? "🗑️ Deleted " + p : "❌ Failed to delete " + p);
  }
  Serial.println("✅ All firmware deleted");
  return true;
}

bool deleteFirmwareByIndex(int targetIndex) {
  if (!ensureSPIFFS())
    return false;
  std::vector<String> files;
  int count = collectFirmwareFiles(files);
  if (count == 0) {
    Serial.println("No downloaded firmware found");
    return false;
  }
  if (targetIndex < 1 || targetIndex > files.size()) {
    Serial.println("❌ Invalid selection");
    return false;
  }
  String path = files[targetIndex - 1];
  bool ok = SPIFFS.remove(path);
  Serial.println(ok ? "🗑️ Deleted " + path : "❌ Failed to delete " + path);
  return ok;
}

// ==== Install firmware from SPIFFS (OTA) ====
bool installFirmwareFromSPIFFS(int targetIndex) {
  if (!ensureSPIFFS()) {
    Serial.println("❌ SPIFFS not mounted");
    return false;
  }

  std::vector<String> files;
  int count = collectFirmwareFiles(files);

  if (count == 0) {
    Serial.println("No downloaded firmware found");
    return false;
  }

  if (targetIndex < 1 || targetIndex > files.size()) {
    Serial.println("❌ Invalid selection");
    return false;
  }

  String path = files[targetIndex - 1];
  File file = SPIFFS.open(path);
  if (!file) {
    Serial.println("❌ Failed to open firmware file");
    return false;
  }

  size_t size = file.size();
  Serial.printf("🚀 Installing firmware (%d bytes)\n", size);

  otaStatus = "installing";
  otaProgress = "";
  otaMessage = "Installing firmware";

  if (!Update.begin(size)) {
    Serial.println("❌ Update begin failed");
    file.close();
    otaStatus = "error";
    otaMessage = "Install failed";
    return false;
  }

  size_t written = Update.writeStream(file);
  file.close();

  if (written != size) {
    Serial.println("❌ Update writeStream incomplete");
    Serial.print("Expected bytes: ");
    Serial.println((int)size);
    Serial.print("Written bytes: ");
    Serial.println((int)written);
    otaStatus = "error";
    otaMessage = "Install failed";
    Update.abort();
    return false;
  }

  if (!Update.end(true)) {
    Serial.print("❌ Update failed: ");
    Serial.println(Update.errorString());
    otaStatus = "error";
    otaMessage = "Install failed";
    return false;
  }

  otaStatus = "done";
  otaMessage = "Install complete, rebooting";
  Serial.println("✅ Firmware installed successfully");
  Serial.println("🔁 Rebooting...");
  delay(500);
  ESP.restart();
  return true;
}

bool downloadFirmware(const String &binName) {
  if (!ensureSPIFFS()) {
    Serial.println("❌ SPIFFS not mounted");
    return false;
  }

  if (!SPIFFS.exists(FIRMWARE_DIR)) {
    SPIFFS.mkdir(FIRMWARE_DIR);
  }

  String cleanName = binName;
  if (cleanName.startsWith("/"))
    cleanName.remove(0, 1);

  String localPath = String(FIRMWARE_DIR) + "/" + cleanName;

  String url =
    String("https://raw.githubusercontent.com/joe32/Pet-Feed---Dog-Bowl/main/PetFeed-ESP-Code/Firmware/") + cleanName;

  Serial.print("⬇️ Downloading ");
  Serial.println(url);

  HTTPClient http;
  http.begin(url);
  int code = http.GET();
  int totalSize = http.getSize();  // bytes, may be -1 if unknown
  unsigned long lastPrintMs = 0;

  // Require a known Content-Length so we can guarantee full download
  if (code == HTTP_CODE_OK) {
    if (totalSize <= 0) {
      Serial.println("❌ Download failed: missing/invalid Content-Length");
      http.end();
      return false;
    }
  }

  if (code != HTTP_CODE_OK) {
    Serial.print("❌ HTTP error: ");
    Serial.println(code);
    http.end();
    return false;
  }

  File f = SPIFFS.open(localPath, FILE_WRITE);
  if (!f) {
    Serial.println("❌ Failed to open file for writing");
    http.end();
    return false;
  }

  WiFiClient *stream = http.getStreamPtr();
  // Verify this looks like an ESP32 firmware image (first byte should be 0xE9)
  // If GitHub returns HTML/text, this will fail and we abort rather than saving junk.
  while (http.connected() && stream->available() == 0) {
    delay(10);
    yield();
  }
  int first = stream->read();
  if (first < 0) {
    Serial.println("❌ Download failed: no data received");
    f.close();
    http.end();
    return false;
  }
  if ((uint8_t)first != 0xE9) {
    Serial.println("❌ Download failed: not a firmware binary (bad header)");
    Serial.print("First byte was 0x");
    Serial.println((uint8_t)first, HEX);
    f.close();
    http.end();
    SPIFFS.remove(localPath);
    return false;
  }
  // Write the first byte we consumed
  f.write((uint8_t)first);
  int total = 1;

  uint8_t buffer[1024];
  // NOTE: total already initialised to 1 after writing the verified first byte

  // --- OTA stability fix: safer content-length-based download loop ---
  while (http.connected() && (total < totalSize)) {
    size_t available = stream->available();
    if (!available) {
      delay(10);
      yield();
      continue;
    }

    int len = stream->readBytes(buffer, min(sizeof(buffer), available));
    if (len <= 0) continue;

    f.write(buffer, len);
    total += len;

    if (millis() - lastPrintMs >= 300) {
      lastPrintMs = millis();
      float doneMB = total / (1024.0f * 1024.0f);

      if (totalSize > 0) {
        float totalMB = totalSize / (1024.0f * 1024.0f);
        Serial.printf("⬇️ %.2f / %.2f MB\n", doneMB, totalMB);
        otaProgress = String(doneMB, 2) + "/" + String(totalMB, 2) + " MB";
      } else {
        Serial.printf("⬇️ %.2f MB\n", doneMB);
        otaProgress = String(doneMB, 2) + " MB";
      }

      otaStatus = "downloading";
      otaMessage = "Downloading firmware";
    }

    yield();
  }
  // --- End OTA stability fix loop ---

  // Final size verification (must match Content-Length exactly)
  if (total != totalSize) {
    Serial.println("❌ Download incomplete — size mismatch");
    Serial.print("Expected bytes: ");
    Serial.println(totalSize);
    Serial.print("Received bytes: ");
    Serial.println(total);
    otaStatus = "error";
    otaMessage = "Download incomplete";
    f.close();
    http.end();
    SPIFFS.remove(localPath);
    return false;
  }

  f.close();
  http.end();

  otaStatus = "downloading";
  otaMessage = "Download complete";

  Serial.printf("✅ Download complete: %s (%d bytes)\n", localPath.c_str(), total);
  return true;
}

// ================= BLE =================

#define SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// ===== CLAIM (SECONDARY BLE FOR WIFI DEVICES) =====
#define CLAIM_SERVICE_UUID "9b3a9f10-2c2e-4b6f-9f6a-9b4f5e7c1111"
#define CLAIM_CHARACTERISTIC_UUID "9b3a9f10-2c2e-4b6f-9f6a-9b4f5e7c2222"

BLECharacteristic *pClaimCharacteristic = nullptr;
BLEServer *pClaimServer = nullptr;
BLEService *pClaimService = nullptr;

BLEServer *pServer = nullptr;
BLECharacteristic *pCharacteristic = nullptr;
bool deviceConnected = false;

// ================= STORAGE =================
Preferences prefs;
bool wifiEverConnected = false;
bool wifiCredsPending = false;

// ================= WIFI / HTTP =================
WebServer server(80);
String wifiSSID = "";
String wifiPASS = "";
String mdnsHost = "";
String deviceMode = "ble";

bool isNetworkMode() {
  return deviceMode == "wifi" || deviceMode == "cloud";
}

WiFiUDP discoveryUdp;
const uint16_t DISCOVERY_PORT = 4210;
unsigned long lastDiscoveryBroadcast = 0;

// ================= WIFI SCAN STATE =================
unsigned long wifiScanStart = 0;
bool wifiScanActive = false;
String lastWifiScanResult = "";

// BLE WiFi scan task coordination (avoid doing WiFi ops inside BLE callback)
volatile bool wifiScanRequested = false;
volatile bool wifiScanInProgress = false;
TaskHandle_t wifiScanTaskHandle = nullptr;

// ================= TIME =================
int lastPrintedMinute = -1;
int lastPrintedHour = -1;

bool hasSchedule = false;
int scheduledHour = -1;
int scheduledMinute = -1;
bool scheduleExecutedToday = false;

void checkUpdateTask(void *param) {
  bool isAuto = (param != NULL);
  checkUpdateRunning = true;

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ check-update aborted: WiFi not connected");
    if (isAuto) {
      autoCheckResult = "error";
    } else {
      checkUpdateResult = "error";
    }
    checkUpdateRunning = false;
    checkUpdateTaskHandle = nullptr;
    vTaskDelete(NULL);
    return;
  }

  Serial.println(isAuto ? "🔎 AUTO UPDATE: running check task" : "🔎 Running check-update task");

  checkLatestRelease();

  // Copy result into correct bucket
  if (isAuto) {
    autoCheckResult = checkUpdateResult;
    autoCheckLatest = checkUpdateLatest;
  }

  // ===== AUTO UPDATE SCHEDULING =====
  if (isAuto && autoUpdateEnabled) {
    if (checkUpdateResult == "update_available") {
      Serial.print("🆕 AUTO UPDATE: update found ");
      Serial.println(checkUpdateLatest);

      // (Re)create a schedule if none exists or if schedule is stale
      if (preferredUpdateHour >= 0 && preferredUpdateMinute >= 0) {
        // Only schedule if we don't already have a schedule, or if it was for a previous day
        struct tm nowT;
        int today = -1;
        if (getLocalTime(&nowT)) {
          today = nowT.tm_yday;
        }

        bool stale = (scheduledUpdateDayOfYear != -1 && today != -1 && scheduledUpdateDayOfYear != today);
        if (!autoUpdateScheduled || stale) {
          scheduledUpdateHour = preferredUpdateHour;
          scheduledUpdateMinute = preferredUpdateMinute;
          scheduledUpdateDayOfYear = (today != -1) ? today : -1;
          autoUpdateScheduled = true;
          autoUpdateStarted = false;

          Serial.print("⏳ AUTO UPDATE: scheduled for ");
          Serial.printf("%02d:%02d\n", scheduledUpdateHour, scheduledUpdateMinute);
        }
      }
    } else if (checkUpdateResult == "up_to_date") {
      Serial.println("✅ AUTO UPDATE: already up to date");
      clearAutoUpdateSchedule("up-to-date");
    } else {
      Serial.println("⚠️ AUTO UPDATE: check failed");
      // Do not clear schedule here; allow existing schedule to remain
    }
  }

  checkUpdateRunning = false;
  checkUpdateTaskHandle = nullptr;
  vTaskDelete(NULL);
}

void checkLatestRelease() {
  // Make sure WiFi is connected
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected, cannot check updates");
    return;
  }

  String jsonUrl = String("https://raw.githubusercontent.com/joe32/Pet-Feed---Dog-Bowl/main/PetFeed-ESP-Code/Firmware/latest.json") + "?t=" + String(millis());

  Serial.print("Fetching update info from: ");
  Serial.println(jsonUrl);

  HTTPClient http;
  http.begin(jsonUrl);
  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.print("HTTP error: ");
    Serial.println(httpCode);
    checkUpdateResult = "error";
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  Serial.println("Received JSON:");
  Serial.println(payload);

  // Parse JSON
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("JSON parse failed: ");
    Serial.println(error.c_str());
    checkUpdateResult = "error";
    return;
  }

  latestVersionName = String((const char *)doc["version"]);
  latestBinName = String((const char *)doc["bin"]);

  Serial.print("Latest version: ");
  Serial.println(latestVersionName);

  Serial.print("Latest bin file: ");
  Serial.println(latestBinName);

  // Compare to your version
  Serial.print("Current version: ");
  Serial.println(FW_VERSION);
  if (latestVersionName == String(FW_VERSION)) {
    Serial.println("Already up to date.");
    checkUpdateResult = "up_to_date";
    checkUpdateLatest = "";
  } else {
    Serial.println("Update available!");
    checkUpdateResult = "update_available";
    checkUpdateLatest = latestVersionName;
  }
}

bool fullAutoUpdate() {
  Serial.println("🔎 Checking for latest firmware...");
  checkLatestRelease();

  if (latestBinName.length() == 0) {
    Serial.println("❌ No update info available");
    return false;
  }

  if (latestVersionName == String(FW_VERSION)) {
    Serial.println("✅ Already on latest firmware");
    return true;
  }

  // Store latestBinName in a local variable
  String downloadedBin = latestBinName;

  Serial.print("⬇️ Downloading ");
  Serial.println(downloadedBin);

  if (!downloadFirmware(downloadedBin)) {
    Serial.println("❌ Download failed");
    return false;
  }

  // Find the index of the downloaded firmware
  int foundIndex = findFirmwareIndexByName(downloadedBin);
  if (foundIndex == -1) {
    Serial.println("❌ Downloaded firmware file not found in SPIFFS");
    return false;
  }
  bool installed = installFirmwareFromSPIFFS(foundIndex);
  return installed;
}

// ===== OTA FreeRTOS Task Wrapper =====
void otaTask(void *param) {
  otaRunning = true;
  bool ok = fullAutoUpdate();
  otaRunning = false;

  // If an automatic update attempt failed, allow retry/reschedule after backoff
  if (!ok) {
    lastAutoUpdateAttemptMs = millis();
    Serial.println("❌ AUTO UPDATE: OTA attempt failed");
  }

  otaTaskHandle = nullptr;
  vTaskDelete(NULL);
}

void serverTask(void *param) {
  for (;;) {
    if (isNetworkMode()) {
      server.handleClient();
      ArduinoOTA.handle();
    }
    vTaskDelay(1);  // yield to WiFi stack
  }
}
// Helper: Find firmware index by name (1-based for installFirmwareFromSPIFFS)
int findFirmwareIndexByName(const String &binName) {
  std::vector<String> files;
  int count = collectFirmwareFiles(files);
  if (count == 0)
    return -1;

  for (int i = 0; i < files.size(); i++) {
    if (files[i].endsWith(binName)) {
      return i + 1;  // installFirmwareFromSPIFFS is 1-based
    }
  }
  return -1;
}
// Helper: Remove all firmware except current version
void cleanupFirmwareExceptCurrent() {
  if (!ensureSPIFFS())
    return;

  std::vector<String> files;
  int count = collectFirmwareFiles(files);
  if (count == 0)
    return;

  for (auto &path : files) {
    String name = path;
    if (name.startsWith(FIRMWARE_DIR "/")) {
      name.remove(0, strlen(FIRMWARE_DIR) + 1);
    }

    if (!name.endsWith(String(FW_VERSION) + ".bin")) {
      SPIFFS.remove(path);
      Serial.println("🧹 Removed old firmware: " + name);
    }
  }
}

void setUKTimezone() {
  setenv("TZ", "GMT0BST,M3.5.0/1,M10.5.0/2", 1);
  tzset();
}

void performWifiScan(bool verboseSerial) {
  Serial.println("📡 Starting Wi‑Fi scan");
  int n = WiFi.scanNetworks(/*async=*/false, /*hidden=*/true);
  lastWifiScanResult = "";

  if (n <= 0) {
    Serial.println("⚠️ No Wi‑Fi networks found");
    return;
  }

  for (int i = 0; i < n; i++) {
    lastWifiScanResult += WiFi.SSID(i);
    if (i < n - 1)
      lastWifiScanResult += ",";
  }

  if (verboseSerial) {
    Serial.print("📶 Networks found: ");
    Serial.println(lastWifiScanResult);
  }
}

// ================= SERVO =================
Servo myServo;
const int servoPin = 6;  // KEEP GPIO 6
const int LID_OPEN = 0;
const int LID_CLOSED = 120;

bool lidIsOpen = false;
int currentAngle = LID_CLOSED;

// ================= BUZZER =================
const int buzzerPin = 5;
const int buzzerChannel = 7;
const int buzzerResolution = 8;

// ===== BUZZER PREFS =====
// These are persisted (survive reboot/OTA). Defaults are ON.
bool beepOnManualOpenClose = true;   // open/close button presses
bool beepOnScheduleChange  = true;   // schedule/cancel schedule actions
bool beepOnScheduledFeed   = true;   // scheduled feeding alert beeps

void saveBuzzerPrefs() {
  prefs.begin("petfeed", false);
  prefs.putBool("beepOC", beepOnManualOpenClose);
  prefs.putBool("beepSC", beepOnScheduleChange);
  prefs.putBool("beepSF", beepOnScheduledFeed);
  prefs.end();
}

void loadBuzzerPrefs() {
  // Keep current in-code defaults unless prefs override them
  prefs.begin("petfeed", true);

  if (prefs.isKey("beepOC")) {
    beepOnManualOpenClose = prefs.getBool("beepOC", beepOnManualOpenClose);
  }
  if (prefs.isKey("beepSC")) {
    beepOnScheduleChange = prefs.getBool("beepSC", beepOnScheduleChange);
  }
  if (prefs.isKey("beepSF")) {
    beepOnScheduledFeed = prefs.getBool("beepSF", beepOnScheduledFeed);
  }

  prefs.end();
}

// ================= RESET BUTTON =================
const int resetButtonPin = 7;  // push button to GND
bool resetButtonLast = HIGH;
unsigned long resetButtonPressStart = 0;
bool resetTriggered = false;

void toneOn(int freq) {
  ledcWriteTone(buzzerChannel, freq);
  // Force maximum duty cycle for loudest possible output
  ledcWrite(buzzerChannel, 255);
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

void scheduledFeedBeep() {
  if (!beepOnScheduledFeed) {
    Serial.println("🔕 Scheduled feeding beep disabled");
    return;
  }

  // Long repeating tone to alert a scheduled feed
  for (int i = 0; i < 6; i++) {
    toneOn(1400);
    delay(350);
    toneOff();
    delay(250);
  }
}

// ================= HELPER: NOTIFY LID STATE =================
void notifyLidState() {
  if (!pCharacteristic)
    return;

  String state = lidIsOpen ? "STATE:OPEN" : "STATE:CLOSED";
  pCharacteristic->setValue(state.c_str());
  pCharacteristic->notify();

  Serial.print("📤 Sent lid state: ");
  Serial.println(state);
}

// ================= HELPER: SAVE/LOAD SCHEDULE =================
void saveSchedule() {
  prefs.begin("petfeed", false);
  prefs.putBool("hasSchedule", hasSchedule);
  prefs.putInt("schHour", scheduledHour);
  prefs.putInt("schMin", scheduledMinute);
  prefs.end();
}

void loadSchedule() {
  prefs.begin("petfeed", true);
  hasSchedule = prefs.getBool("hasSchedule", false);
  scheduledHour = prefs.getInt("schHour", -1);
  scheduledMinute = prefs.getInt("schMin", -1);
  prefs.end();
}

// ================= AUTO UPDATE PREFS =================
void saveAutoUpdatePrefs() {
  prefs.begin("petfeed", false);
  prefs.putBool("autoUpd", autoUpdateEnabled);
  prefs.putInt("updHour", preferredUpdateHour);
  prefs.putInt("updMin", preferredUpdateMinute);
  prefs.end();
}

void loadAutoUpdatePrefs() {
  // Use compile-time defaults unless prefs explicitly override them
  prefs.begin("petfeed", true);

  // If keys don't exist yet (fresh device / after prefs.clear), keep defaults
  if (prefs.isKey("autoUpd")) {
    autoUpdateEnabled = prefs.getBool("autoUpd", autoUpdateEnabled);
  }
  if (prefs.isKey("updHour")) {
    preferredUpdateHour = prefs.getInt("updHour", preferredUpdateHour);
  }
  if (prefs.isKey("updMin")) {
    preferredUpdateMinute = prefs.getInt("updMin", preferredUpdateMinute);
  }

  prefs.end();

  // Safety clamp
  if (preferredUpdateHour < 0 || preferredUpdateHour > 23 || preferredUpdateMinute < 0 || preferredUpdateMinute > 59) {
    autoUpdateEnabled = true;
    preferredUpdateHour = 0;
    preferredUpdateMinute = 1;
  }
}

// ================= HELPER: NOTIFY SCHEDULE =================
void notifySchedule() {
  // NOTE: BLE notification only; app now relies on HTTP GETSCHEDULE
  if (!pCharacteristic)
    return;

  if (!hasSchedule) {
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
void servoWriteSmooth(int targetAngle) {
  if (targetAngle == currentAngle)
    return;

  if (targetAngle < currentAngle) {
    for (int i = currentAngle; i >= targetAngle; i--) {
      myServo.write(i);
      delay(5);
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
  if (lidIsOpen)
    return;
  Serial.println("🔓 OPEN");
  myServo.attach(servoPin);
  servoWriteSmooth(LID_OPEN);
  delay(300);
  myServo.detach();
  lidIsOpen = true;
  if (beepOnManualOpenClose) {
    clickBeep();
  }
  notifyLidState();
}

void moveLidClosed() {
  if (!lidIsOpen)
    return;
  Serial.println("🔒 CLOSE");
  myServo.attach(servoPin);
  servoWriteSmooth(LID_CLOSED);
  delay(300);
  myServo.detach();
  lidIsOpen = false;
  if (beepOnManualOpenClose) {
    clickBeep();
  }
  notifyLidState();
}

// ================= FACTORY RESET =================
void factoryReset() {
  Serial.println("🧨 FACTORY RESET");

  prefs.begin("petfeed", false);
  prefs.clear();
  prefs.end();

  // Re-apply default auto-update prefs after factory reset
  autoUpdateEnabled = true;
  preferredUpdateHour = 0;
  preferredUpdateMinute = 1;
  saveAutoUpdatePrefs();

  // Clear any in-memory scheduled auto update
  clearAutoUpdateSchedule("factory reset");

  mdnsHost = "";

  BLEDevice::deinit(true);
  delay(200);
  // BLEDevice::init("PetFeeder1"); // BLE disabled until setup mode

  wifiSSID = "";
  wifiPASS = "";
  deviceMode = "ble";

  BLEDevice::startAdvertising();
}

// ================= WIFI MODE =================

// ===== CLAIM BLE CALLBACK =====
class ClaimCharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String cmd = String(c->getValue().c_str());
    cmd.trim();

    Serial.print("📥 CLAIM write received: '");
    Serial.print(cmd);
    Serial.println("'");

    if (cmd == "CLAIM") {
      String host = mdnsHost.length() ? mdnsHost : "petfeeder";
      String reply = "HOST:" + host;

      c->setValue(reply.c_str());
      c->notify();

      Serial.print("📤 CLAIM response sent: ");
      Serial.println(reply);
    }
  }
};

class ClaimServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    Serial.println("📱 CLAIM BLE connected");
  }

  void onDisconnect(BLEServer *) override {
    Serial.println("📴 CLAIM BLE disconnected — restarting advertising");
    BLEDevice::startAdvertising();
  }
};
void startCloudMode() {
  Serial.println("☁️ CLOUD MODE: initialising");

  // Cloud mode ALWAYS relies on Wi‑Fi mode underneath
  Serial.println("☁️ CLOUD MODE: starting Wi‑Fi subsystem");
  startWifiMode();

  // Placeholder for future cloud connection (MQTT / HTTPS)
  Serial.println("☁️ CLOUD MODE: Wi‑Fi ready, cloud layer not yet implemented");
}

void startWifiMode() {
  Serial.println("📡 Wi-Fi mode");

  // ===== BLE DISABLED IN WIFI MODE =====
  // Serial.println("🔧 Initialising CLAIM BLE service");

  // BLEDevice::init("PetFeeder");
  //
  // pClaimServer = BLEDevice::createServer();
  // pClaimServer->setCallbacks(new ClaimServerCallbacks());
  //
  // pClaimService = pClaimServer->createService(CLAIM_SERVICE_UUID);
  //
  // pClaimCharacteristic = pClaimService->createCharacteristic(
  //   CLAIM_CHARACTERISTIC_UUID,
  //   BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);
  //
  // pClaimCharacteristic->addDescriptor(new BLE2902());
  // pClaimCharacteristic->setCallbacks(new ClaimCharacteristicCallbacks());
  //
  // pClaimService->start();
  //
  // BLEAdvertising *adv = BLEDevice::getAdvertising();
  // adv->stop();
  // adv->addServiceUUID(CLAIM_SERVICE_UUID);
  //
  // // Slow BLE advertising to coexist with Wi‑Fi
  // adv->setMinInterval(0x200); // ~320ms
  // adv->setMaxInterval(0x400); // ~640ms
  //
  // adv->start();

  // Explicitly disable BLE while in Wi‑Fi mode to prevent radio contention
  BLEDevice::deinit(true);
  delay(200);

  // Serial.println("🔵 CLAIM BLE advertising started (Wi‑Fi mode)");

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

    // Only factory reset if this is the FIRST ever Wi‑Fi setup
    // or immediately after credentials were changed
    prefs.begin("petfeed", true);
    bool everConnected = prefs.getBool("wifiEverConnected", false);
    bool credsPending = prefs.getBool("wifiCredsPending", false);
    prefs.end();

    if (!everConnected || credsPending) {
      Serial.println("🧨 Wi‑Fi failed during initial setup — factory reset");
      factoryReset();
    } else {
      Serial.println("⚠️ Wi‑Fi failed, but device was previously connected — staying configured");
    }

    ESP.restart();
    return;
  }

  Serial.print("✅ IP: ");
  Serial.println(WiFi.localIP());

  // Mark Wi‑Fi as successfully connected at least once
  prefs.begin("petfeed", false);
  prefs.putBool("wifiEverConnected", true);
  prefs.putBool("wifiCredsPending", false);
  prefs.end();

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  delay(1500);
  setUKTimezone();

  if (mdnsHost.length()) {
    Serial.print("🔧 Starting mDNS with hostname: ");
    Serial.println(mdnsHost);

    if (MDNS.begin(mdnsHost.c_str())) {
      Serial.print("🌐 mDNS started successfully: ");
      Serial.print(mdnsHost);
      Serial.println(".local");
    } else {
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
  if (mdnsHost.length()) {
    ArduinoOTA.setHostname(mdnsHost.c_str());
  } else {
    ArduinoOTA.setHostname("petfeeder");
  }
  ArduinoOTA.setPassword("ota");

  ArduinoOTA.onStart([]() {
    Serial.println("🔁 OTA update start");
  });

  ArduinoOTA.onEnd([]() {
    Serial.println("✅ OTA update complete");
  });

  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("❌ OTA error[%u]\n", error);
  });

  ArduinoOTA.begin();
  Serial.println("📡 OTA ready");
  checkLatestRelease();

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

  // ================= GET LID STATE (APP) =================
  server.on("/GETSTATE", HTTP_GET, []() {
    StaticJsonDocument<64> doc;
    doc["state"] = lidIsOpen ? "OPEN" : "CLOSED";

    String res;
    serializeJson(doc, res);
    server.send(200, "application/json", res);
  });

  // ================= OTA UPDATES(APP) =================

  server.on("/version", HTTP_GET, []() {
    // Serial.println("📥 HTTP /version called");
    StaticJsonDocument<64> doc;
    doc["version"] = FW_VERSION;
    String res;
    serializeJson(doc, res);
    // Serial.print("📤 Responding with version: ");
    // Serial.println(FW_VERSION);
    server.send(200, "application/json", res);
  });

  // ===== AUTO UPDATE PREFS (APP) =====

  // Get auto-update preferences
  server.on("/update-prefs", HTTP_GET, []() {
    Serial.println("📥 HTTP /update-prefs [GET] called");
    Serial.print("📤 Current autoUpdateEnabled: ");
    Serial.println(autoUpdateEnabled ? "true" : "false");
    Serial.print("📤 Current preferred time: ");
    if (preferredUpdateHour >= 0 && preferredUpdateMinute >= 0) {
      Serial.printf("%02d:%02d\n", preferredUpdateHour, preferredUpdateMinute);
    } else {
      Serial.println("not set");
    }

    StaticJsonDocument<128> doc;
    doc["enabled"] = autoUpdateEnabled;
    if (preferredUpdateHour >= 0 && preferredUpdateMinute >= 0) {
      char buf[6];
      sprintf(buf, "%02d:%02d", preferredUpdateHour, preferredUpdateMinute);
      doc["time"] = buf;
    } else {
      doc["time"] = "";
    }

    String res;
    serializeJson(doc, res);
    Serial.println("📤 Sending /update-prefs response to app");
    server.send(200, "application/json", res);
  });

  // Save auto-update preferences
  server.on("/update-prefs", HTTP_POST, []() {
    Serial.println("📥 HTTP /update-prefs [POST] called");
    if (!server.hasArg("plain")) {
      server.send(400, "text/plain", "no body");
      return;
    }

    StaticJsonDocument<128> doc;
    if (deserializeJson(doc, server.arg("plain"))) {
      server.send(400, "text/plain", "bad json");
      return;
    }

    Serial.print("📥 Raw JSON body: ");
    Serial.println(server.arg("plain"));

    autoUpdateEnabled = doc["enabled"] | false;

    String time = doc["time"] | "";
    if (time.length()) {
      int colon = time.indexOf(":");
      if (colon > 0) {
        preferredUpdateHour = time.substring(0, colon).toInt();
        preferredUpdateMinute = time.substring(colon + 1).toInt();
      }
    }

    Serial.print("📤 New autoUpdateEnabled: ");
    Serial.println(autoUpdateEnabled ? "true" : "false");

    Serial.print("📤 New preferred update time: ");
    if (preferredUpdateHour >= 0 && preferredUpdateMinute >= 0) {
      Serial.printf("%02d:%02d\n", preferredUpdateHour, preferredUpdateMinute);
    } else {
      Serial.println("cleared / not set");
    }

    saveAutoUpdatePrefs();

    // If user changes auto-update settings/time, cancel any existing scheduled update.
    // If an update is currently available, immediately schedule again for the new preferred time.
    clearAutoUpdateSchedule("prefs changed");

    if (autoUpdateEnabled && checkUpdateResult == "update_available" && preferredUpdateHour >= 0 && preferredUpdateMinute >= 0) {
      struct tm nowT;
      int today = -1;
      if (getLocalTime(&nowT)) {
        today = nowT.tm_yday;
      }

      scheduledUpdateHour = preferredUpdateHour;
      scheduledUpdateMinute = preferredUpdateMinute;
      scheduledUpdateDayOfYear = (today != -1) ? today : -1;
      autoUpdateScheduled = true;
      autoUpdateStarted = false;

      Serial.print("⏳ AUTO UPDATE: re-scheduled for ");
      Serial.printf("%02d:%02d\n", scheduledUpdateHour, scheduledUpdateMinute);
    }

    Serial.println("✅ Auto‑update preferences saved and acknowledged to app");
    server.send(200, "application/json", "{\"status\":\"saved\"}");
  });

  // ===== BUZZER PREFS (APP) =====
  // Get buzzer preferences
  server.on("/buzzer-prefs", HTTP_GET, []() {
    Serial.println("📥 HTTP /buzzer-prefs [GET] called");

    StaticJsonDocument<128> doc;
    doc["openClose"] = beepOnManualOpenClose;
    doc["scheduleChange"] = beepOnScheduleChange;
    doc["scheduledFeed"] = beepOnScheduledFeed;

    String res;
    serializeJson(doc, res);

    Serial.print("📤 /buzzer-prefs response: ");
    Serial.println(res);

    server.send(200, "application/json", res);
  });
  server.on("/buzzer-prefs", HTTP_POST, []() {
    Serial.println("📥 HTTP /buzzer-prefs [POST] called");

    if (!server.hasArg("plain")) {
      server.send(400, "text/plain", "no body");
      return;
    }

    StaticJsonDocument<128> doc;
    if (deserializeJson(doc, server.arg("plain"))) {
      server.send(400, "text/plain", "bad json");
      return;
    }

    // Read new values (default to current if missing)
    if (doc.containsKey("openClose")) {
      beepOnManualOpenClose = doc["openClose"];
    }

    if (doc.containsKey("schedule")) {
      beepOnScheduleChange = doc["schedule"];
    }

    if (doc.containsKey("feeding")) {
      beepOnScheduledFeed = doc["feeding"];
    }

    saveBuzzerPrefs();

    Serial.println("🔔 BUZZER PREFS UPDATED:");
    Serial.print(" - open/close: ");
    Serial.println(beepOnManualOpenClose ? "true" : "false");
    Serial.print(" - schedule change: ");
    Serial.println(beepOnScheduleChange ? "true" : "false");
    Serial.print(" - scheduled feed: ");
    Serial.println(beepOnScheduledFeed ? "true" : "false");

    server.send(200, "application/json", "{\"status\":\"saved\"}");
  });

  server.on("/check-update", HTTP_GET, []() {
    Serial.println("📥 HTTP /check-update called");

    // If a check is already running, wait for it to finish (up to 5s)
    unsigned long startWait = millis();
    while (checkUpdateRunning && millis() - startWait < 5000) {
      delay(20);
      yield();
    }

    // If no check is running, start one and block until it finishes
    if (!checkUpdateRunning && checkUpdateTaskHandle == nullptr) {
      // Mark as running BEFORE starting the task so HTTP waits correctly
      checkUpdateRunning = true;

      xTaskCreatePinnedToCore(
        checkUpdateTask,
        "checkUpdateTask",
        6144,
        NULL,
        1,
        &checkUpdateTaskHandle,
        0
      );

      // Wait for task to finish (max 5s)
      unsigned long start = millis();
      while (checkUpdateRunning && millis() - start < 5000) {
        delay(20);
        yield();
      }
    }

    // Respond with the LAST COMPLETED result
    StaticJsonDocument<128> doc;
    doc["status"] = checkUpdateResult;
    doc["latest"] = checkUpdateLatest;
    doc["current"] = FW_VERSION;

    String res;
    serializeJson(doc, res);

    Serial.print("📤 /check-update response: ");
    Serial.println(res);

    server.send(200, "application/json", res);
  });

  server.on("/update", HTTP_POST, []() {
    Serial.println("📥 HTTP /update called");
    // If user manually updates, cancel any pending automatic schedule
    clearAutoUpdateSchedule("manual update requested");
    autoUpdateCheckPending = false;
    if (!otaRunning && otaTaskHandle == nullptr) {
      otaStatus = "checking";
      otaMessage = "Update requested";
      xTaskCreatePinnedToCore(
        otaTask,
        "otaTask",
        8192,
        NULL,
        1,  // low priority
        &otaTaskHandle,
        0  // RUN OTA ON CORE 0 (WiFi core), keep loop/server on core 1
      );
    }
    Serial.println("📤 Update task trigger response sent to app");
    server.send(200, "application/json", "{\"status\":\"started\"}");
  });

  server.on("/update-status", HTTP_GET, []() {
    Serial.println("📥 HTTP /update-status called");
    StaticJsonDocument<128> doc;
    doc["status"] = otaStatus;
    doc["progress"] = otaProgress;
    doc["message"] = otaMessage;

    if (otaRunning) {
      doc["busy"] = true;
    } else {
      doc["busy"] = false;
    }

    String res;
    serializeJson(doc, res);
    Serial.print("📤 OTA status: ");
    Serial.print(otaStatus);
    Serial.print(" | progress: ");
    Serial.print(otaProgress);
    Serial.print(" | message: ");
    Serial.println(otaMessage);
    server.send(200, "application/json", res);
  });

  // ================= AUTO UPDATE SCHEDULE (APP) =================

  // Return current scheduled auto update (if any)
  server.on("/update-schedule", HTTP_GET, []() {
    Serial.println("📥 HTTP /update-schedule called");

    StaticJsonDocument<160> doc;

    if (!autoUpdateScheduled || scheduledUpdateHour < 0 || scheduledUpdateMinute < 0) {
      doc["scheduled"] = false;
      doc["time"] = "";
      doc["latest"] = "";
    } else {
      doc["scheduled"] = true;

      char buf[6];
      sprintf(buf, "%02d:%02d", scheduledUpdateHour, scheduledUpdateMinute);
      doc["time"] = buf;

      // optional: include the version we believe is available
      doc["latest"] = checkUpdateLatest;
    }

    String res;
    serializeJson(doc, res);

    Serial.print("📤 /update-schedule response: ");
    Serial.println(res);

    server.send(200, "application/json", res);
  });

  // Cancel any scheduled auto update (used when user taps "Install now")
  server.on("/cancel-update", HTTP_POST, []() {
    Serial.println("📥 HTTP /cancel-update called");
    clearAutoUpdateSchedule("cancelled by app");
    server.send(200, "application/json", "{\"status\":\"cancelled\"}");
  });

  // ================= UPDATE WIFI (APP) =================
  server.on("/update-wifi", HTTP_POST, []() {
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
    prefs.putBool("wifiCredsPending", true);
    prefs.end();

    server.send(200, "application/json", "{\"status\":\"saved\",\"reboot\":true}");

    Serial.println("🔁 Rebooting to apply new Wi‑Fi...");
    Serial.flush();
    delay(800);
    ESP.restart();
  });

  // ================= GET SCHEDULE (APP) =================
  server.on("/GETSCHEDULE", HTTP_GET, []() {
    StaticJsonDocument<128> doc;

    if (!hasSchedule) {
      doc["hasSchedule"] = false;
      String res;
      serializeJson(doc, res);
      server.send(200, "application/json", res);
      // Serial.println("📤 GETSCHEDULE → NONE");
      return;
    }

    doc["hasSchedule"] = true;
    doc["hour"] = scheduledHour;
    doc["minute"] = scheduledMinute;

    String res;
    serializeJson(doc, res);
    server.send(200, "application/json", res);

    // Serial.print("📤 GETSCHEDULE → ");
    // Serial.print(scheduledHour);
    // Serial.print(":");
    // Serial.println(scheduledMinute);
  });

  // ================= SCHEDULE HTTP ROUTES =================
  server.on("/SCHEDULE", HTTP_POST, []() {
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
    if (beepOnScheduleChange) {
      confirmBeep();
    }
    Serial.println("✅ Schedule saved successfully");
    server.send(200, "application/json", "{\"status\":\"scheduled\"}");
  });

  server.on("/CANCEL_SCHEDULE", HTTP_POST, []() {
    Serial.println("📥 HTTP /CANCEL_SCHEDULE called");
    hasSchedule = false;
    scheduledHour = -1;
    scheduledMinute = -1;
    scheduleExecutedToday = false;
    saveSchedule();
    notifySchedule();
    if (beepOnScheduleChange) {
      beep(900, 120);
    }
    Serial.println("🗑️ Schedule cancelled");
    server.send(200, "application/json", "{\"status\":\"cancelled\"}");
  });

  server.begin();
  // Serial.println("🚫 HTTP /WIFISCAN disabled — BLE only");
  if (serverTaskHandle == nullptr) {
    xTaskCreatePinnedToCore(
      serverTask,
      "serverTask",
      4096,
      NULL,
      1,
      &serverTaskHandle,
      1  // Core 1: keep HTTP server isolated from OTA
    );
  }
}

// ================= BLE WiFi scan task =================
void wifiScanTask(void *param) {
  wifiScanInProgress = true;
  wifiScanRequested = false;

  Serial.println("📡 BLE WIFISCAN: running scan task");

  // Keep BLE alive; just use WiFi STA scanning.
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, true);
  delay(200);

  int n = WiFi.scanNetworks(false, true); // sync scan (safer in its own task)

  if (n <= 0) {
    Serial.println("⚠️ BLE WIFISCAN: no networks found");
    if (pCharacteristic) {
      pCharacteristic->setValue("WIFI_SCAN:EMPTY");
      pCharacteristic->notify();
    }
    WiFi.scanDelete();
    wifiScanInProgress = false;
    wifiScanTaskHandle = nullptr;
    vTaskDelete(NULL);
    return;
  }

  String result = "WIFI_SCAN:";
  for (int i = 0; i < n; i++) {
    result += WiFi.SSID(i);
    if (i < n - 1) result += ",";
  }

  WiFi.scanDelete();

  if (pCharacteristic) {
    pCharacteristic->setValue(result.c_str());
    pCharacteristic->notify();
  }

  Serial.print("📤 BLE WIFISCAN response sent: ");
  Serial.println(result);

  wifiScanInProgress = false;
  wifiScanTaskHandle = nullptr;
  vTaskDelete(NULL);
}

// ================= BLE CALLBACKS =================
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    deviceConnected = true;
    Serial.println("📱 BLE connected");
  }
  void onDisconnect(BLEServer *) override {
    deviceConnected = false;
    Serial.println("📴 BLE disconnected");
    BLEDevice::startAdvertising();
  }
};

class CharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    Serial.print("📨 BLE raw payload: ");
    Serial.println(c->getValue().c_str());

    String cmd = String(c->getValue().c_str());
    cmd.trim();

    // ================= WIFI SCAN (BLE) =================
    if (cmd == "WIFISCAN") {
      Serial.println("📡 BLE WIFISCAN command received");

      if (wifiScanInProgress) {
        Serial.println("⚠️ BLE WIFISCAN: scan already in progress, ignoring");
        return;
      }

      // Request scan and run it in a dedicated task to avoid crashes/reboots inside BLE callback
      wifiScanRequested = true;

      if (wifiScanTaskHandle == nullptr) {
        xTaskCreatePinnedToCore(
          wifiScanTask,
          "wifiScanTask",
          6144,
          NULL,
          1,
          &wifiScanTaskHandle,
          0
        );
      }

      return;
    }

    if (!cmd.startsWith("WIFI:")) {
      return;
    }

    wifiSSID = "";
    wifiPASS = "";
    mdnsHost = "";

    int s1 = cmd.indexOf("ssid=");
    int p1 = cmd.indexOf("pass=");
    int h1 = cmd.indexOf("host=");
    int m1 = cmd.indexOf("mode=");

    if (s1 >= 0) {
      int end = cmd.indexOf(";", s1);
      if (end < 0)
        end = cmd.length();
      wifiSSID = cmd.substring(s1 + 5, end);
    }

    if (p1 >= 0) {
      int end = cmd.indexOf(";", p1);
      if (end < 0)
        end = cmd.length();
      wifiPASS = cmd.substring(p1 + 5, end);
    }

    if (h1 >= 0) {
      int end = cmd.indexOf(";", h1);
      if (end < 0)
        end = cmd.length();
      mdnsHost = cmd.substring(h1 + 5, end);
    }

    String newMode = "wifi"; // default

    if (m1 >= 0) {
      int end = cmd.indexOf(";", m1);
      if (end < 0)
        end = cmd.length();
      newMode = cmd.substring(m1 + 5, end);
      newMode.trim();
      newMode.toLowerCase();

      // allow only supported values
      if (newMode != "wifi" && newMode != "cloud") {
        Serial.print("⚠️ Unknown mode received, defaulting to wifi: ");
        Serial.println(newMode);
        newMode = "wifi";
      }
    }

    // HARD GUARD: if SSID accidentally contains "WIFI:ssid=", strip it
    if (wifiSSID.startsWith("WIFI:ssid=")) {
      wifiSSID.replace("WIFI:ssid=", "");
    }

    Serial.println("📥 Final provisioning values:");
    Serial.print("SSID: ");
    Serial.println(wifiSSID);
    Serial.print("PASS length: ");
    Serial.println(wifiPASS.length());
    Serial.print("HOST: ");
    Serial.println(mdnsHost);
    Serial.print("MODE: ");
    Serial.println(newMode);

    if (!wifiSSID.length() || !wifiPASS.length()) {
      Serial.println("❌ Invalid Wi‑Fi credentials received, aborting");
      return;
    }

    prefs.begin("petfeed", false);
    prefs.putString("ssid", wifiSSID);
    prefs.putString("pass", wifiPASS);
    prefs.putString("host", mdnsHost);
    prefs.putString("mode", newMode);
    prefs.putBool("wifiCredsPending", true);
    prefs.end();

    c->setValue("WIFI_SAVED");
    c->notify();
    confirmBeep();

    if (newMode == "cloud") {
      Serial.println("🔁 Rebooting into Cloud mode...");
    } else {
      Serial.println("🔁 Rebooting into Wi‑Fi mode...");
    }
    Serial.flush();
    delay(1500);
    ESP.restart();
  }
};

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(resetButtonPin, INPUT_PULLUP);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  ledcSetup(buzzerChannel, 2000, buzzerResolution);
  ledcAttachPin(buzzerPin, buzzerChannel);
  // Ensure buzzer is completely silent on boot/reboot
  ledcWrite(buzzerChannel, 0);
  toneOff();

  myServo.attach(servoPin);
  myServo.write(LID_CLOSED);
  delay(400);
  myServo.detach();
  lidIsOpen = false;
  currentAngle = LID_CLOSED;
  Serial.println("🔒 Lid forced closed on startup");

  if (!SPIFFS.begin(false)) {
    Serial.println("❌ SPIFFS mount failed at boot");
  } else {
    spiffsMounted = true;
    if (!SPIFFS.exists(FIRMWARE_DIR)) {
      SPIFFS.mkdir(FIRMWARE_DIR);
    }
    Serial.println("📁 SPIFFS ready");
  }

  // Clean up old firmware except current before checking deviceMode
  cleanupFirmwareExceptCurrent();

  prefs.begin("petfeed", true);
  deviceMode = prefs.getString("mode", "ble");
  wifiSSID = prefs.getString("ssid", "");
  wifiPASS = prefs.getString("pass", "");
  mdnsHost = prefs.getString("host", "");
  prefs.end();

  prefs.begin("petfeed", true);
  wifiEverConnected = prefs.getBool("wifiEverConnected", false);
  wifiCredsPending = prefs.getBool("wifiCredsPending", false);
  prefs.end();

  loadSchedule();
  loadAutoUpdatePrefs();
  loadBuzzerPrefs();

  if (deviceMode == "cloud" && wifiSSID.length()) {
    Serial.println("☁️ Device mode = CLOUD");
    startCloudMode();
    return;
  }

  if (deviceMode == "wifi" && wifiSSID.length()) {
    Serial.println("📡 Device mode = WIFI");
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
void loop() {
  // Safety guard: NEVER allow network tasks during BLE-only mode
  if (!isNetworkMode() && checkUpdateRunning) {
    Serial.println("⚠️ Forcing check-update stop (BLE mode)");
    checkUpdateRunning = false;
  }
  // If a scan was requested but the task isn't running (edge case), start it here.
  if (wifiScanRequested && !wifiScanInProgress && wifiScanTaskHandle == nullptr) {
    xTaskCreatePinnedToCore(
      wifiScanTask,
      "wifiScanTask",
      6144,
      NULL,
      1,
      &wifiScanTaskHandle,
      0
    );
  }
  // ================= RESET BUTTON HANDLING =================
  bool resetButtonState = digitalRead(resetButtonPin);

  // Button pressed (HIGH -> LOW)
  if (resetButtonLast == HIGH && resetButtonState == LOW) {
    Serial.println("🔘 Reset button PRESSED");
    resetButtonPressStart = millis();
    resetTriggered = false;
  }

  // Button held down
  if (resetButtonState == LOW && resetButtonPressStart > 0) {
    unsigned long heldMs = millis() - resetButtonPressStart;

    static unsigned long lastDot = 0;
    if (millis() - lastDot >= 500) {
      lastDot = millis();
      Serial.print(".");
    }

    // After 5 seconds: start continuous danger tone
    if (heldMs >= 5000 && !resetTriggered) {
      Serial.println();
      Serial.println("🚨 RESET ARMING — RELEASE TO CONFIRM");
      toneOn(2800);  // continuous high‑pitched warning tone
      resetTriggered = true;
    }
  }

  // Button released (LOW -> HIGH)
  if (resetButtonLast == LOW && resetButtonState == HIGH) {
    Serial.println();
    Serial.println("🔘 Reset button RELEASED");

    // If reset was armed, releasing triggers factory reset
    if (resetTriggered) {
      Serial.println("🧨 FACTORY RESET CONFIRMED");
      toneOff();
      delay(200);
      factoryReset();
      ESP.restart();
    }

    resetButtonPressStart = 0;
    resetTriggered = false;
  }

  resetButtonLast = resetButtonState;

  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "version") {
      Serial.print("Firmware version: ");
      Serial.println(FW_VERSION);
    }

    if (cmd == "checkupdate") {
      checkLatestRelease();
    }

    if (cmd == "download") {
      checkLatestRelease();

      Serial.println("Download latest firmware? (y/n)");
      while (!Serial.available())
        delay(10);
      String ans = Serial.readStringUntil('\n');
      ans.trim();

      if (ans == "y" || ans == "Y") {
        if (latestBinName.length() == 0) {
          Serial.println("❌ No latest firmware info available");
        } else {
          downloadFirmware(latestBinName);
        }
      } else {
        Serial.println("❎ Download cancelled");
      }
    }

    if (cmd == "list") {
      listDownloadedFirmware();
    }

    if (cmd == "delete") {
      listDownloadedFirmware();
      Serial.println("0. Delete ALL firmware");
      Serial.println("Type number to delete");

      while (!Serial.available())
        delay(10);
      String sel = Serial.readStringUntil('\n');
      sel.trim();

      int choice = sel.toInt();

      if (choice == 0) {
        deleteAllFirmware();
      } else if (choice > 0) {
        deleteFirmwareByIndex(choice);
      } else {
        Serial.println("❌ Invalid choice");
      }
    }

    if (cmd == "install") {
      listDownloadedFirmware();
      delay(50);
      Serial.println("Type number to install");
      while (!Serial.available())
        delay(10);
      String sel = Serial.readStringUntil('\n');
      sel.trim();

      int choice = sel.toInt();
      if (choice > 0) {
        installFirmwareFromSPIFFS(choice);
      } else {
        Serial.println("❌ Invalid choice");
      }
    }

    if (cmd == "update") {
      fullAutoUpdate();
    }

    if (cmd == "open")
      moveLidOpen();
    if (cmd == "close")
      moveLidClosed();
    if (cmd == "factory") {
      factoryReset();
      ESP.restart();
    }
    if (cmd == "network") {
      Serial.println("🧪 Serial Wi‑Fi scan (5s test)");
      unsigned long start = millis();
      while (millis() - start < 5000) {
        performWifiScan(true);
        delay(1000);
      }
    }
  }

  // ================= OTA BACKGROUND EXECUTION =================
  // (Removed: now handled by FreeRTOS task in response to /update)

  // ================= AUTO UPDATE CHECK (EVERY 1 MIN - TESTING) =================
  // IMPORTANT: never run the HTTP update check on the main loop (can trigger watchdog / reboots).
  // Always run it in the existing FreeRTOS task, and never while OTA is running.
  if (isNetworkMode()) {
    if (!autoUpdateEnabled) {
      autoUpdateScheduled = false;
      autoUpdateStarted = false;
    }
    if (autoUpdateEnabled) {
      if (millis() - lastAutoUpdateCheckMs >= AUTO_UPDATE_INTERVAL_MS) {
        lastAutoUpdateCheckMs = millis();

        Serial.println("🔁 AUTO UPDATE: periodic check triggered");

        if (otaRunning) {
          Serial.println("⏸️ AUTO UPDATE: skipped (OTA running)");
        } else if (!checkUpdateRunning && checkUpdateTaskHandle == nullptr) {
          autoCheckResult = "unknown";
          autoCheckLatest = "";

          // If we recently failed an OTA attempt, avoid hammering; wait a short backoff
          if (lastAutoUpdateAttemptMs > 0 && (millis() - lastAutoUpdateAttemptMs) < AUTO_UPDATE_RETRY_BACKOFF_MS) {
            Serial.println("⏳ AUTO UPDATE: backoff active after failed OTA attempt");
          } else {
            xTaskCreatePinnedToCore(
              checkUpdateTask,
              "checkUpdateTaskAuto",
              6144,
              (void*)1,   // <-- mark as AUTO
              1,
              &checkUpdateTaskHandle,
              0
            );
          }
        } else {
          Serial.println("⏸️ AUTO UPDATE: skipped (check already running)");
        }
      }
    }
  }

  // Print time once per minute, exactly at :00 seconds (non-blocking)
  if (isNetworkMode()) {
    struct tm t;
    if (getLocalTime(&t)) {
      if (t.tm_sec == 0 && (t.tm_min != lastPrintedMinute || t.tm_hour != lastPrintedHour)) {
        lastPrintedMinute = t.tm_min;
        lastPrintedHour = t.tm_hour;
        Serial.printf("⏰ Time: %02d:%02d:%02d\n", t.tm_hour, t.tm_min, t.tm_sec);
      }

      if (hasSchedule && !scheduleExecutedToday && t.tm_hour == scheduledHour && t.tm_min == scheduledMinute) {
        Serial.println("🍽️ Executing scheduled feed");
        scheduledFeedBeep();
        moveLidOpen();

        // Cancel schedule after execution (one‑time schedule)
        hasSchedule = false;
        scheduledHour = -1;
        scheduledMinute = -1;
        scheduleExecutedToday = true;
        saveSchedule();
        notifySchedule();

        Serial.println("🗑️ Schedule cleared after execution");
      }

      // Reset daily execution flags at midnight
      if (t.tm_hour == 0 && t.tm_min == 0 && t.tm_sec == 0) {
        scheduleExecutedToday = false;
        autoUpdateStarted = false;
        scheduledUpdateDayOfYear = -1;
      }

      // ================= AUTO UPDATE EXECUTION =================
      if (autoUpdateScheduled &&
          autoUpdateEnabled &&
          !autoUpdateStarted &&
          preferredUpdateHour >= 0 &&
          preferredUpdateMinute >= 0 &&
          WiFi.status() == WL_CONNECTED &&
          t.tm_hour == scheduledUpdateHour &&
          t.tm_min == scheduledUpdateMinute) {

        Serial.println("⏰ AUTO UPDATE: scheduled minute reached");
        Serial.print("🕒 AUTO UPDATE: starting at ");
        Serial.printf("%02d:%02d:%02d\n", t.tm_hour, t.tm_min, t.tm_sec);

        autoUpdateStarted = true;      // prevents double-trigger within the same minute
        clearAutoUpdateSchedule("triggered");

        if (!otaRunning && otaTaskHandle == nullptr) {
          Serial.println("🚀 AUTO UPDATE: launching OTA task");
          otaStatus = "checking";
          otaMessage = "Automatic update started";
          xTaskCreatePinnedToCore(
            otaTask,
            "otaTaskAuto",
            8192,
            NULL,
            1,
            &otaTaskHandle,
            0
          );
        } else {
          Serial.println("⚠️ AUTO UPDATE: skipped (OTA already running)");
        }
      }
    }
  }

  // if (deviceMode == "wifi") {
  //   static unsigned long lastBleLog = 0;
  //   if (millis() - lastBleLog > 5000) {
  //     lastBleLog = millis();
  //     // BLE intentionally disabled in Wi‑Fi mode
  //   }
  // }

  // server.handleClient() and ArduinoOTA.handle() now run in FreeRTOS serverTask

  if (isNetworkMode() && millis() - lastDiscoveryBroadcast > 6000) {
    lastDiscoveryBroadcast = millis();

    String host = mdnsHost.length() ? mdnsHost : "petfeeder";
    String payload = "PETFEED|" + host + "|80";

    discoveryUdp.beginPacket("255.255.255.255", DISCOVERY_PORT);
    discoveryUdp.print(payload);
    discoveryUdp.endPacket();
  }

  delay(5);
}
