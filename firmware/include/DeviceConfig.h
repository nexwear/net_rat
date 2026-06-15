#pragma once

#include <Preferences.h>
#include <vector>
#include "types.h"

struct WifiCred {
  String ssid;
  String pass;
};

struct DeviceConfig {
  std::vector<WifiCred> wifi;
  String serverUrl;
  String nodeId;
  String moduleType;
  String lineId;
  String factoryId;
  String token;
  String fwVersion;
  uint16_t otaHrs = 6;
  bool valid = false;
};

class ConfigStore {
 public:
  static bool load(DeviceConfig& out);
  static bool save(const DeviceConfig& cfg);
  static void wipe();
  static bool loadSeq(uint32_t& seq);
  static void saveSeq(uint32_t seq);
  static String chipId();
  static void setPendingFwVersion(const String& version);
  static bool commitPendingFwVersion(DeviceConfig& cfg);
};
