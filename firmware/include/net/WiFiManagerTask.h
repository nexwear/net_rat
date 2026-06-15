#pragma once

#include "DeviceConfig.h"
#include <WiFi.h>

class WiFiManagerTask {
 public:
  explicit WiFiManagerTask(const DeviceConfig& cfg);
  bool connect();
  void loop();
  bool isConnected() const { return WiFi.status() == WL_CONNECTED; }

 private:
  const DeviceConfig& _cfg;
  uint32_t _nextAttemptMs = 0;
  uint8_t _backoffIdx = 0;
};
