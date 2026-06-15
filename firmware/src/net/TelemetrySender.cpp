#include "net/TelemetrySender.h"
#include "types.h"
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

TelemetrySender::TelemetrySender(const DeviceConfig& cfg, OfflineStore& store, QueueHandle_t commandQ)
    : _cfg(cfg), _store(store), _commandQ(commandQ) {}

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

  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Node-Token", _cfg.token);
  const int code = http.POST(body);
  http.end();
  return code >= 200 && code < 300;
}

bool TelemetrySender::postJsonWithResponse(const String& path, const String& body,
                                           String& responseOut) {
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

  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Node-Token", _cfg.token);
  const int code = http.POST(body);
  responseOut = http.getString();
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
      const bool adminAssign =
          _cfg.moduleType == "ADMIN" && static_cast<ScanKind>(ev.scanKind) == ScanKind::ASSIGN_SCAN;
      if (adminAssign) {
        String resp;
        ok = postJsonWithResponse("/v1/scan", body, resp);
        if (_commandQ != nullptr) {
          Command cmd{};
          cmd.type = CmdType::ADMIN_SCAN_FEEDBACK;
          if (ok && resp.length() > 0) {
            JsonDocument respDoc;
            if (deserializeJson(respDoc, resp) == DeserializationError::Ok) {
              cmd.cardNumber = respDoc["cardNumber"] | 0;
              cmd.newlyRegistered = respDoc["newlyRegistered"] | false;
              if (respDoc["ignored"] | false) {
                Serial.printf("[ADMIN] scan ignored (open Cards or Bundles admin panel) uid=%s\n",
                              ev.cardUid);
              } else if (respDoc["unregistered"] | false) {
                Serial.printf("[ADMIN] card not registered uid=%s\n", ev.cardUid);
              } else if (cmd.cardNumber > 0) {
                Serial.printf("[ADMIN] #%03lu %s uid=%s\n", cmd.cardNumber,
                              cmd.newlyRegistered ? "registered" : "already registered", ev.cardUid);
              }
            }
          } else {
            Serial.printf("[ADMIN] scan post failed uid=%s\n", ev.cardUid);
          }
          if (xQueueSend(_commandQ, &cmd, pdMS_TO_TICKS(200)) != pdTRUE) {
            Serial.println("[ADMIN] feedback queue full — NFC will re-arm via timeout");
          }
        }
      } else {
        ok = postJson("/v1/scan", body);
      }
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

bool TelemetrySender::sendHeartbeat(int rssi, uint32_t uptimeSec, size_t queueDepth,
                                    uint32_t flags, String* responseBody) {
  JsonDocument doc;
  doc["nodeId"] = _cfg.nodeId;
  doc["rssi"] = rssi;
  doc["uptime"] = uptimeSec;
  doc["fwVersion"] = _cfg.fwVersion.length() ? _cfg.fwVersion : String(FW_VERSION);
  doc["queueDepth"] = queueDepth;
  doc["flags"] = flags;

  if (ConfigStore::getOpAck()) {
    doc["ackedOp"] = true;
    ConfigStore::clearOpAck();
  }

  String body;
  serializeJson(doc, body);

  if (responseBody) {
    return postJsonWithResponse("/v1/heartbeat", body, *responseBody);
  }
  return postJson("/v1/heartbeat", body);
}
