#pragma once

#include "DeviceConfig.h"
#include <WiFi.h>

// Non-blocking WiFi connection manager. `loop()` must be called frequently from
// the network task; it never blocks for more than a few milliseconds so the rest
// of the net loop (heartbeats, telemetry drain, OTA) keeps running even while the
// radio is reconnecting. `connect()` kicks off the first attempt at boot.
class WiFiManagerTask {
 public:
  explicit WiFiManagerTask(const DeviceConfig& cfg);
  // Boot helper: starts connecting to the first credential and returns
  // immediately. Steady-state reconnection is driven entirely by loop().
  bool connect();
  void loop();
  bool isConnected() const { return WiFi.status() == WL_CONNECTED; }

 private:
  enum class State { IDLE, CONNECTING, CONNECTED };

  void beginAttempt(uint32_t now);

  const DeviceConfig& _cfg;
  State _state = State::IDLE;
  size_t _credIdx = 0;
  uint32_t _attemptStartMs = 0;
  uint32_t _nextAttemptMs = 0;
  uint8_t _backoffIdx = 0;
};
