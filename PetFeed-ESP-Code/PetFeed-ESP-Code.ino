#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <ESP32Servo.h>
#include <time.h>
#include "index_html.h"

const char *ssids[] = {
  "VAST-SW",
  "Joes-Phone",
  // "Midges"
};

const char *passwords[] = {
  "thewilsons",
  "12345678",
  // "00000099"
};

const int wifiCount = 3;

AsyncWebServer server(80);
Servo myServo;
const int servoPin = 6;   // NOTE: GPIO6 is typically used by ESP32 flash
const int buzzerPin = 5;  // PASSIVE buzzer

// ---- LID POSITIONS ----
const int LID_CLOSED = 120;
const int LID_OPEN = 0;
// -----------------------

String scheduledTime = "";
unsigned long lastTimePrint = 0;
const unsigned long printInterval = 10000;

// ---- SERVO STATE (SINGLE SOURCE OF TRUTH) ----
bool lidIsOpen;
int currentAngle = LID_CLOSED;  // <-- SYNC WITH REALITY
// ---------------------------------------------

const int servoMoveDelay = 5;  // closing
const int downDelay = 1;       // opening

// ---- UK timezone helper (BST/GMT auto-switch) ----
void setUKTimezone() {
  setenv("TZ", "GMT0BST,M3.5.0/1,M10.5.0/2", 1);
  tzset();
}
// --------------------------------------------------

// ---- PASSIVE BUZZER (PWM) ----
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

// ---- Sound patterns ----
void confirmBeep() {
  beep(1200, 120);
  delay(80);
  beep(1600, 160);
}

void cancelBeep() {
  beep(1600, 120);
  delay(60);
  beep(900, 220);
}

void clickBeep() {
  beep(1800, 40);
}

void feedingBeep() {
  for (int i = 0; i < 3; i++) {
    beep(900, 450);
    delay(250);
  }
}
// -------------------------

// ---- STATUS LED ----
void updateStatusLED() {
  digitalWrite(LED_BUILTIN, scheduledTime.length() > 0 ? HIGH : LOW);
}
// --------------------

// ---- SERVO MOTION (ONLY CALLED WHEN STATE CHANGES) ----
void servoWriteSmooth(int targetAngle) {

  if (targetAngle == currentAngle) return;

  if (targetAngle < currentAngle) {  // OPENING
    for (int i = currentAngle; i >= targetAngle; i--) {
      myServo.write(i);
      delay(downDelay);
    }
  } else {  // CLOSING
    for (int i = currentAngle; i <= targetAngle; i++) {
      myServo.write(i);
      delay(servoMoveDelay);
    }
  }

  currentAngle = targetAngle;
}

void moveLidOpen() {
  if (lidIsOpen) return;
  myServo.attach(servoPin);
  servoWriteSmooth(LID_OPEN);
  delay(300);
  myServo.detach();
  lidIsOpen = true;
}

void moveLidClosed() {
  if (!lidIsOpen) return;
  myServo.attach(servoPin);
  servoWriteSmooth(LID_CLOSED);
  delay(300);
  myServo.detach();
  lidIsOpen = false;
}
// -----------------------------------------------------

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("dog");

  for (int i = 0; i < wifiCount; i++) {
    WiFi.begin(ssids[i], passwords[i]);

    int attempt = 0;
    while (WiFi.status() != WL_CONNECTED && attempt < 15) {
      delay(1000);
      attempt++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      if (!MDNS.begin("dog")) return;
      MDNS.addService("http", "tcp", 80);

      ArduinoOTA.setHostname("DogFeeder");
      ArduinoOTA.setPassword("ota");
      ArduinoOTA.begin();
      return;
    }

    WiFi.disconnect(true);
    delay(1000);
  }

  WiFi.mode(WIFI_AP);
  WiFi.softAP("ESP32_AP");
}

void setup() {
  Serial.begin(9600);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  ledcSetup(buzzerChannel, 2000, buzzerResolution);
  ledcAttachPin(buzzerPin, buzzerChannel);
  toneOff();

  connectWiFi();

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  delay(2000);
  setUKTimezone();

  setupWebServer();
}

void setupWebServer() {
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send_P(200, "text/html", INDEX_HTML);
  });

  server.on("/activate", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (request->hasParam("time")) {
      scheduledTime = request->getParam("time")->value();
      moveLidClosed();
      confirmBeep();
      updateStatusLED();
    }
    request->send(200, "text/plain", "Activated");
  });

  server.on("/manual", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (request->hasParam("state")) {
      String state = request->getParam("state")->value();

      if (state == "open") {
        moveLidOpen();
        clickBeep();
      } else if (state == "close") {
        moveLidClosed();
        clickBeep();
      }
    }
    request->send(200, "text/plain", "OK");
  });

  server.on("/cancel", HTTP_GET, [](AsyncWebServerRequest *request) {
    scheduledTime = "";
    cancelBeep();
    updateStatusLED();
    request->send(200, "text/plain", "Cancelled");
  });

  server.begin();
}

void loop() {
  ArduinoOTA.handle();
  checkTime();
}

void checkTime() {
  if (scheduledTime.length() == 0) return;

  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return;

  char currentTime[6];
  sprintf(currentTime, "%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min);

  if (String(currentTime) == scheduledTime) {
    moveLidOpen();
    feedingBeep();
    scheduledTime = "";
    updateStatusLED();
  }
}