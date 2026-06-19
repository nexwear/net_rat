#include "DeviceConfig.h"
#include <ArduinoJson.h>
#include <WiFi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

namespace {
constexpr const char* kNs = "cfg";

// All NVS access is serialized through one recursive mutex so concurrent writers
// (NetTask seq/opAck/OTA, loopTask SerialCfg) never overlap a flash transaction
// or interleave a multi-key save(). Recursive because commitPendingFwVersion()
// calls save() while already holding it.
SemaphoreHandle_t gNvsMutex = nullptr;

struct NvsLock {
  NvsLock() {
    if (gNvsMutex) xSemaphoreTakeRecursive(gNvsMutex, portMAX_DELAY);
  }
  ~NvsLock() {
    if (gNvsMutex) xSemaphoreGiveRecursive(gNvsMutex);
  }
};

bool getBool(Preferences& prefs, const char* key, bool fallback) {
  return prefs.isKey(key) ? prefs.getBool(key) : fallback;
}
}  // namespace

void ConfigStore::initMutex() {
  if (!gNvsMutex) {
    gNvsMutex = xSemaphoreCreateRecursiveMutex();
  }
}

String ConfigStore::chipId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[13];
  snprintf(buf, sizeof(buf), "%012llX", mac);
  return String(buf);
}

bool ConfigStore::load(DeviceConfig& out) {
  NvsLock lock;
  Preferences prefs;
  if (!prefs.begin(kNs, true)) {
    out.valid = false;
    return false;
  }

  const bool provDone = getBool(prefs, "provDone", false);
  out.serverUrl = prefs.getString("server", "");
  out.nodeId = prefs.getString("nodeId", "");
  out.moduleType = prefs.getString("moduleType", "INPUT");
  out.label = prefs.getString("label", "");
  out.lineId = prefs.getString("lineId", "");
  out.factoryId = prefs.getString("factoryId", "");
  out.token = prefs.getString("token", "");
  out.fwVersion = prefs.getString("fwVersion", FW_VERSION);
  out.otaHrs = prefs.getUShort("otaHrs", 6);

  out.wifi.clear();
  const String wifiJson = prefs.getString("wifi", "");
  if (wifiJson.length() > 0) {
    JsonDocument doc;
    if (deserializeJson(doc, wifiJson) == DeserializationError::Ok && doc.is<JsonArray>()) {
      for (JsonObject item : doc.as<JsonArray>()) {
        WifiCred cred;
        cred.ssid = item["s"].as<String>();
        cred.pass = item["p"].as<String>();
        if (cred.ssid.length() > 0) {
          out.wifi.push_back(cred);
        }
      }
    }
  }

  prefs.end();

  out.valid = provDone && out.wifi.size() > 0 && out.nodeId.length() > 0 &&
              out.serverUrl.length() > 0 && out.token.length() > 0;
  return out.valid;
}

bool ConfigStore::save(const DeviceConfig& cfg) {
  NvsLock lock;
  Preferences prefs;
  if (!prefs.begin(kNs, false)) {
    return false;
  }

  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (const auto& cred : cfg.wifi) {
    JsonObject item = arr.add<JsonObject>();
    item["s"] = cred.ssid;
    item["p"] = cred.pass;
  }
  String wifiJson;
  serializeJson(arr, wifiJson);

  prefs.putString("wifi", wifiJson);
  prefs.putString("server", cfg.serverUrl);
  prefs.putString("nodeId", cfg.nodeId);
  prefs.putString("moduleType", cfg.moduleType);
  prefs.putString("label", cfg.label);
  prefs.putString("lineId", cfg.lineId);
  prefs.putString("factoryId", cfg.factoryId);
  prefs.putString("token", cfg.token);
  prefs.putString("fwVersion", cfg.fwVersion.length() ? cfg.fwVersion : String(FW_VERSION));
  prefs.putUShort("otaHrs", cfg.otaHrs);
  prefs.putBool("provDone", true);
  prefs.end();
  return true;
}

void ConfigStore::wipe() {
  NvsLock lock;
  Preferences prefs;
  if (prefs.begin(kNs, false)) {
    prefs.clear();
    prefs.end();
  }
}

bool ConfigStore::loadSeq(uint32_t& seq) {
  NvsLock lock;
  Preferences prefs;
  if (!prefs.begin(kNs, true)) {
    seq = 0;
    return false;
  }
  seq = prefs.getUInt("seq", 0);
  prefs.end();
  return true;
}

void ConfigStore::saveSeq(uint32_t seq) {
  NvsLock lock;
  Preferences prefs;
  if (prefs.begin(kNs, false)) {
    prefs.putUInt("seq", seq);
    prefs.end();
  }
}

void ConfigStore::setPendingFwVersion(const String& version) {
  NvsLock lock;
  Preferences prefs;
  if (prefs.begin(kNs, false)) {
    prefs.putString("pendingFw", version);
    prefs.end();
  }
}

bool ConfigStore::commitPendingFwVersion(DeviceConfig& cfg) {
  NvsLock lock;
  Preferences prefs;
  if (!prefs.begin(kNs, true)) {
    return false;
  }
  if (!prefs.isKey("pendingFw")) {
    prefs.end();
    return false;
  }
  const String pending = prefs.getString("pendingFw", "");
  prefs.end();
  if (pending.length() == 0) {
    return false;
  }

  cfg.fwVersion = pending;
  if (!save(cfg)) {
    return false;
  }

  prefs.begin(kNs, false);
  prefs.remove("pendingFw");
  prefs.end();
  Serial.printf("[OTA] Committed fwVersion=%s to NVS\n", pending.c_str());
  return true;
}

void ConfigStore::setOpAck() {
  NvsLock lock;
  Preferences prefs;
  if (prefs.begin(kNs, false)) {
    prefs.putBool("opAck", true);
    prefs.end();
  }
}

bool ConfigStore::getOpAck() {
  NvsLock lock;
  Preferences prefs;
  if (!prefs.begin(kNs, true)) {
    return false;
  }
  const bool val = getBool(prefs, "opAck", false);
  prefs.end();
  return val;
}

void ConfigStore::clearOpAck() {
  NvsLock lock;
  Preferences prefs;
  if (prefs.begin(kNs, false)) {
    prefs.remove("opAck");
    prefs.end();
  }
}
