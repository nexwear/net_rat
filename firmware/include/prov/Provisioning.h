#pragma once

#include "DeviceConfig.h"

class Provisioning {
 public:
  enum class Result { RUNNING, COMPLETE, FAILED };

  static Result run(DeviceConfig& cfg, ModuleType hint = ModuleType::MOD_INPUT);
  /** SoftAP portal — update WiFi + server URL only; keeps nodeId/token. */
  static Result runWifiOnly(DeviceConfig& cfg, ModuleType hint = ModuleType::MOD_INPUT);
  static void factoryReset();
  static String apName(ModuleType hint);

 private:
  static bool startSoftAp(ModuleType hint);
  static bool handlePortal(DeviceConfig& cfg, ModuleType hint, bool wifiOnly);
  static bool claimDevice(DeviceConfig& cfg, ModuleType hint);
  static bool pollUntilApproved(DeviceConfig& cfg);
};
