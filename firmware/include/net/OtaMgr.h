#pragma once

#include "DeviceConfig.h"
#include "net/OfflineStore.h"

class OtaMgr {
 public:
  OtaMgr(const DeviceConfig& cfg, OfflineStore& store);

  void handle(bool wifiUp, bool sessionOpen);

 private:
  bool checkForUpdate(String& outVersion, String& outUrl, String& outSha256);
  bool downloadAndApply(const String& version, const String& url, const String& expectedSha256);
  bool report(bool success, const String& fromVersion, const String& toVersion, const char* detail);
  bool postJson(const String& path, const String& body, String* responseBody);

  const DeviceConfig& _cfg;
  OfflineStore& _store;
  uint32_t _lastCheckMs = 0;
  bool _updateInProgress = false;
};
