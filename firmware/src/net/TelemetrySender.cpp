#include "net/TelemetrySender.h"
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

TelemetrySender::TelemetrySender(const DeviceConfig& cfg, OfflineStore& store) : _cfg(cfg), _store(store) {}

bool TelemetrySender::postJson(const String& path, const String& body) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  const String url = _cfg.serverUrl + path;
  const bool useTls = _cfg.serverUrl.startsWith("https://");

  HTTPClient http;
  bool begun = false;

  if (useTls) {
    WiFiClientSecure client;
    client.setInsecure();
    begun = http.begin(client, url);
  } else {
    WiFiClient client;
    begun = http.begin(client, url);
  }

  if (!begun) {
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Node-Token", _cfg.token);
  const int code = http.POST(body);
  http.end();
  return code >= 200 && code < 300;
}

bool TelemetrySender::send(const TelemetryEvent& ev) {
  JsonDocument doc;

  doc["eventId"] = ev.eventId;
  doc["seq"] = ev.seq;
  doc["nodeId"] = _cfg.nodeId;
  doc["moduleType"] = _cfg.moduleType;
  doc["ts"] = ev.tsEpochMs;
  doc["tsValid"] = ev.tsValid;

  String body;
  bool ok = false;

  switch (ev.type) {
    case TelemetryType::SCAN: {
      doc["kind"] = scanKindToString(static_cast<ScanKind>(ev.scanKind));
      doc["cardUid"] = ev.cardUid;
      serializeJson(doc, body);
      ok = postJson("/v1/scan", body);
      break;
    }
    case TelemetryType::SESSION_UPDATE:
    case TelemetryType::SESSION_CLOSE: {
      doc["sessionId"] = ev.sessionId;
      doc["cardUid"] = ev.cardUid;
      doc["type"] = ev.type == TelemetryType::SESSION_UPDATE ? "UPDATE" : "CLOSE";
      JsonObject counts = doc["counts"].to<JsonObject>();
      counts["pass"] = ev.countPass;
      counts["cycle"] = ev.countCycle;
      if (ev.type == TelemetryType::SESSION_UPDATE) {
        doc["currentAmps"] = ev.currentAmps;
      } else {
        doc["closeReason"] = closeReasonToString(static_cast<CloseReason>(ev.closeReason));
      }
      serializeJson(doc, body);
      ok = postJson("/v1/session", body);
      break;
    }
    case TelemetryType::UNASSIGNED: {
      doc["cardUid"] = ev.cardUid;
      JsonObject counts = doc["counts"].to<JsonObject>();
      counts["pass"] = ev.countPass;
      counts["cycle"] = ev.countCycle;
      serializeJson(doc, body);
      ok = postJson("/v1/unassigned", body);
      break;
    }
    case TelemetryType::HEARTBEAT:
      return sendHeartbeat(WiFi.RSSI(), millis() / 1000, 0, 0);
  }

  if (!ok) {
    _store.push(ev);
  }
  return ok;
}

bool TelemetrySender::sendHeartbeat(int rssi, uint32_t uptimeSec, size_t queueDepth, uint32_t flags) {
  JsonDocument doc;
  doc["nodeId"] = _cfg.nodeId;
  doc["rssi"] = rssi;
  doc["uptime"] = uptimeSec;
  doc["fwVersion"] = _cfg.fwVersion.length() ? _cfg.fwVersion : String(FW_VERSION);
  doc["queueDepth"] = queueDepth;
  doc["flags"] = flags;

  String body;
  serializeJson(doc, body);
  return postJson("/v1/heartbeat", body);
}
