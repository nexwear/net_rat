#include "net/WiFiManagerTask.h"
#include <WiFi.h>

namespace {
constexpr uint32_t BACKOFF_MS[] = {1000, 2000, 5000, 15000, 30000};
constexpr size_t BACKOFF_COUNT = 5;
bool gWifiEventsRegistered = false;

void registerWifiEvents() {
  if (gWifiEventsRegistered) {
    return;
  }
  gWifiEventsRegistered = true;
  WiFi.onEvent([](arduino_event_id_t event, arduino_event_info_t info) {
    switch (event) {
      case ARDUINO_EVENT_WIFI_STA_CONNECTED:
        Serial.println("[WiFi] STA connected to AP");
        break;
      case ARDUINO_EVENT_WIFI_STA_GOT_IP:
        Serial.printf("[WiFi] Got IP %s\n", WiFi.localIP().toString().c_str());
        break;
      case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
        Serial.printf("[WiFi] Disconnected (reason %d)\n", info.wifi_sta_disconnected.reason);
        break;
      default:
        break;
    }
  });
}

void configureSta() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(WIFI_PS_NONE);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);
}
}  // namespace

WiFiManagerTask::WiFiManagerTask(const DeviceConfig& cfg) : _cfg(cfg) {
  registerWifiEvents();
  configureSta();
}

bool WiFiManagerTask::connect() {
  if (isConnected()) {
    return true;
  }

  if (_cfg.wifi.empty()) {
    Serial.println("[WiFi] No saved credentials");
    return false;
  }

  for (const auto& cred : _cfg.wifi) {
    Serial.printf("[WiFi] Connecting to \"%s\"...\n", cred.ssid.c_str());
    WiFi.disconnect(false, true);
    delay(100);
    WiFi.begin(cred.ssid.c_str(), cred.pass.c_str());

    const uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - start) < 20000) {
      delay(250);
    }

    if (isConnected()) {
      Serial.printf("[WiFi] Connected — IP %s RSSI %d\n", WiFi.localIP().toString().c_str(),
                    WiFi.RSSI());
      return true;
    }
    Serial.printf("[WiFi] Failed to join \"%s\"\n", cred.ssid.c_str());
  }

  Serial.println("[WiFi] All saved networks failed");
  return false;
}

void WiFiManagerTask::loop() {
  if (isConnected()) {
    _backoffIdx = 0;
    return;
  }

  const uint32_t now = millis();
  if (now < _nextAttemptMs) {
    return;
  }

  connect();
  const uint32_t delayMs = BACKOFF_MS[_backoffIdx < BACKOFF_COUNT ? _backoffIdx : BACKOFF_COUNT - 1];
  _backoffIdx = _backoffIdx < BACKOFF_COUNT - 1 ? _backoffIdx + 1 : _backoffIdx;
  _nextAttemptMs = now + delayMs;
}
