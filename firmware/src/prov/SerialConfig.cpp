#include "prov/SerialConfig.h"

#include <Arduino.h>
#include <ArduinoJson.h>

namespace SerialCfg {

namespace {
String gBuf;
}  // namespace

bool readLine(String& out) {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n' || c == '\r') {
      if (gBuf.length() == 0) continue;  // skip blank / CRLF pairs
      out = gBuf;
      gBuf = "";
      out.trim();
      return out.length() > 0;
    }
    if (gBuf.length() < 512) {
      gBuf += c;
    } else {
      gBuf = "";  // overflow guard — drop the runaway line
    }
  }
  return false;
}

bool applyCfg(const String& line, DeviceConfig& cfg) {
  if (!line.startsWith("CFG ")) return false;
  const String json = line.substring(4);

  JsonDocument doc;
  if (deserializeJson(doc, json) != DeserializationError::Ok) {
    printErr("bad json");
    return false;
  }

  const String ssid = doc["ssid"] | "";
  const String pass = doc["pass"] | "";
  const String server = doc["server"] | "";
  const String module = doc["module"] | "";
  const String label = doc["label"] | "";

  if (ssid.length() == 0) {
    printErr("ssid required");
    return false;
  }

  cfg.wifi.clear();
  WifiCred cred;
  cred.ssid = ssid;
  cred.pass = pass;
  cfg.wifi.push_back(cred);

  if (server.length() > 0) cfg.serverUrl = server;
  if (module.length() > 0) cfg.moduleType = module;
  cfg.label = label;  // may be empty to clear

  return true;
}

void printStatus(const DeviceConfig& cfg, const char* state) {
  JsonDocument doc;
  doc["state"] = state;
  doc["nodeId"] = cfg.nodeId;
  doc["module"] = cfg.moduleType;
  doc["label"] = cfg.label;
  doc["server"] = cfg.serverUrl;
  doc["ssid"] = cfg.wifi.empty() ? "" : cfg.wifi.front().ssid;
  doc["provisioned"] = cfg.valid;
  doc["fw"] = cfg.fwVersion;
  String out;
  serializeJson(doc, out);
  Serial.print("STATUS ");
  Serial.println(out);
}

void printOk(const char* detail) {
  Serial.print("OK {\"detail\":\"");
  Serial.print(detail);
  Serial.println("\"}");
}

void printErr(const char* error) {
  Serial.print("ERR {\"error\":\"");
  Serial.print(error);
  Serial.println("\"}");
}

}  // namespace SerialCfg
