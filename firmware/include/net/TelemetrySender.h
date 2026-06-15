#pragma once

#include "DeviceConfig.h"
#include "net/OfflineStore.h"
#include "types.h"

class TelemetrySender {
 public:
  TelemetrySender(const DeviceConfig& cfg, OfflineStore& store);

  bool send(const TelemetryEvent& ev);
  bool sendHeartbeat(int rssi, uint32_t uptimeSec, size_t queueDepth, uint32_t flags);

 private:
  bool postJson(const String& path, const String& body);

  const DeviceConfig& _cfg;
  OfflineStore& _store;
};
