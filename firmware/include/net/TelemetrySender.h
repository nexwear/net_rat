#pragma once

#include "DeviceConfig.h"
#include "net/OfflineStore.h"
#include "types.h"

class TelemetrySender {
 public:
  TelemetrySender(const DeviceConfig& cfg, OfflineStore& store);

  bool send(const TelemetryEvent& ev);
  bool sendHeartbeat(int rssi, uint32_t uptimeSec, size_t queueDepth, uint32_t flags,
                     String* responseBody = nullptr);

 private:
  bool postJson(const String& path, const String& body);
  bool postJsonWithResponse(const String& path, const String& body, String& responseOut);

  const DeviceConfig& _cfg;
  OfflineStore& _store;
};
