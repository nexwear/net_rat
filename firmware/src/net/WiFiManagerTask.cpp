#include "net/WiFiManagerTask.h"
#include <WiFi.h>

namespace {
// Backoff applied after a full pass over all saved credentials fails. Keeps the
// radio from thrashing when the AP is down for a while.
constexpr uint32_t BACKOFF_MS[] = {1000, 2000, 5000, 15000, 30000};
constexpr size_t BACKOFF_COUNT = 5;
// How long to wait for a single credential to associate + get an IP before
// moving on to the next one. Non-blocking — measured across loop() calls.
constexpr uint32_t PER_ATTEMPT_MS = 9000;

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

void WiFiManagerTask::beginAttempt(uint32_t now) {
  const auto& cred = _cfg.wifi[_credIdx];
  Serial.printf("[WiFi] Connecting to \"%s\"...\n", cred.ssid.c_str());
  WiFi.disconnect(false, true);
  WiFi.begin(cred.ssid.c_str(), cred.pass.c_str());
  _attemptStartMs = now;
  _state = State::CONNECTING;
}

bool WiFiManagerTask::connect() {
  if (_cfg.wifi.empty()) {
    Serial.println("[WiFi] No saved credentials");
    return false;
  }
  if (isConnected()) {
    _state = State::CONNECTED;
    return true;
  }
  _credIdx = 0;
  _backoffIdx = 0;
  beginAttempt(millis());
  return false;
}

// Non-blocking reconnection state machine. Returns within a few ms in every
// branch so the caller can keep servicing the rest of the net loop.
void WiFiManagerTask::loop() {
  const uint32_t now = millis();

  if (isConnected()) {
    if (_state != State::CONNECTED) {
      Serial.printf("[WiFi] Connected — IP %s RSSI %d\n", WiFi.localIP().toString().c_str(),
                    WiFi.RSSI());
      _state = State::CONNECTED;
      _backoffIdx = 0;
    }
    return;
  }

  if (_cfg.wifi.empty()) {
    return;
  }

  switch (_state) {
    case State::CONNECTED:
      // Link just dropped — retry immediately, then back off if it keeps failing.
      _state = State::IDLE;
      _credIdx = 0;
      _nextAttemptMs = now;
      break;

    case State::CONNECTING:
      if ((now - _attemptStartMs) >= PER_ATTEMPT_MS) {
        Serial.printf("[WiFi] Failed to join \"%s\"\n", _cfg.wifi[_credIdx].ssid.c_str());
        _credIdx++;
        if (_credIdx >= _cfg.wifi.size()) {
          // Whole list exhausted — apply backoff before the next full pass.
          _credIdx = 0;
          const uint32_t delayMs =
              BACKOFF_MS[_backoffIdx < BACKOFF_COUNT ? _backoffIdx : BACKOFF_COUNT - 1];
          if (_backoffIdx < BACKOFF_COUNT - 1) _backoffIdx++;
          _nextAttemptMs = now + delayMs;
          _state = State::IDLE;
          Serial.printf("[WiFi] All saved networks failed — retry in %lus\n", delayMs / 1000);
        } else {
          beginAttempt(now);
        }
      }
      break;

    case State::IDLE:
      if (now >= _nextAttemptMs) {
        beginAttempt(now);
      }
      break;
  }
}
