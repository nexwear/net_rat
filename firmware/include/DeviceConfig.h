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
  String label;       // human-friendly name, e.g. "Line 1 – Elastic"
  String lineId;
  String factoryId;
  String token;
  String fwVersion;
  uint16_t otaHrs = 6;
  bool valid = false;
};

class ConfigStore {
 public:
  // Create the NVS guard mutex. Call once from setup() before any task starts.
  static void initMutex();
  static bool load(DeviceConfig& out);
  static bool save(const DeviceConfig& cfg);
  /** Persist WiFi/server/module before claim completes (provDone=false). */
  static bool savePending(const DeviceConfig& cfg);
  static bool hasPendingProvision(const DeviceConfig& cfg);
  static void wipe();
  static bool loadSeq(uint32_t& seq);
  static void saveSeq(uint32_t seq);
  static String chipId();
  static void setPendingFwVersion(const String& version);
  static bool commitPendingFwVersion(DeviceConfig& cfg);
  static void setOpAck();
  static bool getOpAck();
  static void clearOpAck();
};
