#include "net/RemoteConfig.h"
#include "DeviceConfig.h"
#include "core/RuntimeFlags.h"
#include <Arduino.h>
#include <ArduinoJson.h>

namespace RemoteConfig {

void apply(JsonObjectConst op) {
  const char* type = op["type"] | "";
  Serial.printf("[CFG] pending op: %s\n", type);

  if (strcmp(type, "SET_MODULE_TYPE") == 0) {
    const char* modType = op["moduleType"] | "";
    if (modType[0] == '\0') {
      Serial.println("[CFG] SET_MODULE_TYPE: missing moduleType, ignoring");
      return;
    }
    DeviceConfig cfg;
    if (!ConfigStore::load(cfg)) {
      Serial.println("[CFG] SET_MODULE_TYPE: config load failed, ignoring");
      return;
    }
    cfg.moduleType = String(modType);
    if (!ConfigStore::save(cfg)) {
      Serial.println("[CFG] SET_MODULE_TYPE: config save failed, ignoring");
      return;
    }
    ConfigStore::setOpAck();
    Serial.printf("[CFG] SET_MODULE_TYPE → %s, rebooting\n", modType);
    delay(200);
    ESP.restart();

  } else if (strcmp(type, "SET_WIFI") == 0) {
    JsonArrayConst wifiArr = op["wifi"].as<JsonArrayConst>();
    if (wifiArr.isNull() || wifiArr.size() == 0) {
      Serial.println("[CFG] SET_WIFI: empty wifi array, ignoring");
      return;
    }
    DeviceConfig cfg;
    if (!ConfigStore::load(cfg)) {
      Serial.println("[CFG] SET_WIFI: config load failed, ignoring");
      return;
    }
    cfg.wifi.clear();
    for (JsonObjectConst entry : wifiArr) {
      const char* ssid = entry["s"] | "";
      const char* pass = entry["p"] | "";
      if (ssid[0] != '\0') {
        WifiCred cred;
        cred.ssid = String(ssid);
        cred.pass = String(pass);
        cfg.wifi.push_back(cred);
      }
    }
    if (cfg.wifi.empty()) {
      Serial.println("[CFG] SET_WIFI: no valid SSIDs, ignoring");
      return;
    }
    if (!ConfigStore::save(cfg)) {
      Serial.println("[CFG] SET_WIFI: config save failed, ignoring");
      return;
    }
    ConfigStore::setOpAck();
    Serial.printf("[CFG] SET_WIFI → %u network(s), rebooting\n", (unsigned)cfg.wifi.size());
    delay(200);
    ESP.restart();

  } else if (strcmp(type, "FACTORY_RESET") == 0) {
    Serial.println("[CFG] FACTORY_RESET — wiping NVS and rebooting");
    delay(200);
    ConfigStore::wipe();
    ESP.restart();

  } else if (strcmp(type, "FORCE_OTA_CHECK") == 0) {
    Serial.println("[CFG] FORCE_OTA_CHECK — triggering immediate OTA check");
    gForceOtaCheck.store(true);

  } else {
    Serial.printf("[CFG] unknown op type: %s, ignoring\n", type);
  }
}

}  // namespace RemoteConfig
