#include "prov/Provisioning.h"
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

namespace {
DNSServer dns;
WebServer server(80);
DeviceConfig* gCfg = nullptr;
ModuleType gHint = ModuleType::MOD_INPUT;
bool gSubmitted = false;

String portalPage() {
  return R"(<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<title>Grewbie Setup</title></head><body><h1>Garment Node Setup</h1>
<form method=POST action=/config>
<label>WiFi SSID <input name=ssid required></label><br>
<label>Password <input name=pass type=password></label><br>
<label>Server URL <input name=server value="http://192.168.1.100:4000"></label><br>
<label>Module <select name=module>
<option>INPUT</option><option>OUTPUT_1</option><option>OUTPUT_2</option><option>ADMIN</option>
</select></label><br>
<button type=submit>Save</button></form></body></html>)";
}

bool testWifi(const String& ssid, const String& pass) {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(WIFI_PS_NONE);
  WiFi.setAutoReconnect(true);
  WiFi.disconnect(false, true);
  delay(100);
  WiFi.begin(ssid.c_str(), pass.c_str());
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < 20000) {
    delay(250);
  }
  const bool ok = WiFi.status() == WL_CONNECTED;
  if (ok) {
    Serial.printf("[PROV] WiFi test OK — IP %s\n", WiFi.localIP().toString().c_str());
    // Stay connected for claim; do not disconnect here
  } else {
    Serial.println("[PROV] WiFi test failed");
  }
  return ok;
}
}  // namespace

String Provisioning::apName(ModuleType hint) {
  const uint64_t mac = ESP.getEfuseMac();
  char buf[48];
  snprintf(buf, sizeof(buf), "Grewbie-%s-%04X", moduleTypeToString(hint), static_cast<unsigned>(mac & 0xFFFF));
  return String(buf);
}

bool Provisioning::startSoftAp(ModuleType hint) {
  const String ssid = apName(hint);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(ssid.c_str(), "grewbie-setup");
  dns.start(53, "*", WiFi.softAPIP());

  server.on("/", HTTP_GET, []() { server.send(200, "text/html", portalPage()); });
  server.on("/scan", HTTP_GET, []() {
    const int n = WiFi.scanNetworks();
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (int i = 0; i < n; i++) {
      arr.add(WiFi.SSID(i));
    }
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });
  server.on("/config", HTTP_POST, []() {
    if (!gCfg) {
      server.send(500, "text/plain", "no cfg");
      return;
    }
    gCfg->wifi.clear();
    WifiCred cred;
    cred.ssid = server.arg("ssid");
    cred.pass = server.arg("pass");
    gCfg->wifi.push_back(cred);
    gCfg->serverUrl = server.arg("server");
    gCfg->moduleType = server.arg("module");
    if (!testWifi(cred.ssid, cred.pass)) {
      server.send(400, "text/plain", "wifi failed");
      return;
    }
    gSubmitted = true;
    server.send(200, "text/plain", "saved — claiming device…");
  });
  server.onNotFound([]() {
    server.sendHeader("Location", "http://192.168.4.1/", true);
    server.send(302, "text/plain", "");
  });
  server.begin();
  return true;
}

bool Provisioning::claimDevice(DeviceConfig& cfg, ModuleType hint) {
  if (WiFi.status() != WL_CONNECTED && cfg.wifi.size() > 0) {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(WIFI_PS_NONE);
    WiFi.setAutoReconnect(true);
    WiFi.begin(cfg.wifi[0].ssid.c_str(), cfg.wifi[0].pass.c_str());
    const uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - start) < 20000) {
      delay(250);
    }
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[PROV] claim: WiFi not connected");
    return false;
  }

  JsonDocument doc;
  doc["chipId"] = ConfigStore::chipId();
  doc["moduleHint"] = moduleTypeToString(hint);
  String body;
  serializeJson(doc, body);

  WiFiClient client;
  HTTPClient http;
  const String url = cfg.serverUrl + "/v1/devices/claim";
  Serial.printf("[PROV] POST %s\n", url.c_str());
  if (!http.begin(client, url)) {
    Serial.println("[PROV] claim: http.begin failed");
    return false;
  }
  http.setTimeout(15000);
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  const String resp = http.getString();
  http.end();
  Serial.printf("[PROV] claim HTTP %d: %s\n", code, resp.c_str());
  if (code < 200 || code >= 300) {
    return false;
  }

  JsonDocument out;
  if (deserializeJson(out, resp) != DeserializationError::Ok) {
    return false;
  }
  cfg.nodeId = out["nodeId"].as<String>();
  cfg.token = out["tempToken"].as<String>();
  return cfg.nodeId.length() > 0 && cfg.token.length() > 0;
}

bool Provisioning::pollUntilApproved(DeviceConfig& cfg) {
  const uint32_t start = millis();
  while ((millis() - start) < 300000) {
    WiFiClient client;
    HTTPClient http;
    const String url = cfg.serverUrl + "/v1/devices/" + cfg.nodeId + "/config";
    if (!http.begin(client, url)) {
      delay(2000);
      continue;
    }
    http.addHeader("X-Node-Token", cfg.token);
    const int code = http.GET();
    const String resp = http.getString();
    http.end();
    if (code >= 200 && code < 300) {
      JsonDocument doc;
      if (deserializeJson(doc, resp) == DeserializationError::Ok) {
        const String status = doc["status"].as<String>();
        if (status == "ACTIVE") {
          cfg.lineId = doc["lineId"].as<String>();
          cfg.factoryId = doc["factoryId"].as<String>();
          cfg.moduleType = doc["moduleType"].as<String>();
          cfg.token = doc["token"].as<String>();
          cfg.otaHrs = doc["otaHrs"] | 6;
          return true;
        }
      }
    }
    delay(3000);
  }
  return false;
}

bool Provisioning::handlePortal(DeviceConfig& cfg, ModuleType hint, bool wifiOnly) {
  gCfg = &cfg;
  gHint = hint;
  gSubmitted = false;
  startSoftAp(hint);

  if (wifiOnly) {
    Serial.println("[PROV] WiFi-only update — enter new WiFi + server URL");
  }

  while (!gSubmitted) {
    dns.processNextRequest();
    server.handleClient();
    delay(10);
  }

  server.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
  delay(200);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(WIFI_PS_NONE);
  WiFi.setAutoReconnect(true);

  if (wifiOnly) {
    Serial.printf("[PROV] WiFi updated — server %s\n", cfg.serverUrl.c_str());
    return true;
  }

  Serial.printf("[PROV] Claiming device at %s\n", cfg.serverUrl.c_str());
  if (!claimDevice(cfg, hint)) {
    Serial.println("[PROV] Claim failed — is backend running? Windows firewall may block port 4000");
    return false;
  }
  if (!pollUntilApproved(cfg)) {
    Serial.println("[PROV] Approval poll failed");
    return false;
  }
  return true;
}

Provisioning::Result Provisioning::run(DeviceConfig& cfg, ModuleType hint) {
  if (!handlePortal(cfg, hint, false)) {
    return Result::FAILED;
  }
  cfg.fwVersion = String(FW_VERSION);
  if (!ConfigStore::save(cfg)) {
    return Result::FAILED;
  }
  return Result::COMPLETE;
}

Provisioning::Result Provisioning::runWifiOnly(DeviceConfig& cfg, ModuleType hint) {
  if (!handlePortal(cfg, hint, true)) {
    return Result::FAILED;
  }
  if (!ConfigStore::save(cfg)) {
    return Result::FAILED;
  }
  return Result::COMPLETE;
}

void Provisioning::factoryReset() { ConfigStore::wipe(); }
