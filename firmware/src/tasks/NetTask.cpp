#include "tasks/NetTask.h"
#include "net/OfflineStore.h"
#include "net/TelemetrySender.h"
#include "net/WiFiManagerTask.h"
#include "prov/Provisioning.h"
#include "util/TimeUtil.h"
#include "DeviceConfig.h"
#include "net/OtaMgr.h"
#include "net/RemoteConfig.h"
#include "core/RuntimeFlags.h"
#include <ArduinoOTA.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <time.h>

namespace {
struct NetContext {
  DeviceConfig cfg;
  QueueHandle_t telemetryQ;
  QueueHandle_t commandQ;
  std::atomic<NodeState>* nodeState;
  uint32_t* seqCounter;
};

bool gOtaReady = false;

void setupArduinoOta(const DeviceConfig& cfg) {
  if (gOtaReady) {
    return;
  }
  const String host =
      cfg.nodeId.length() > 0 ? cfg.nodeId : String("grewbie-") + ConfigStore::chipId().substring(0, 8);
  ArduinoOTA.setHostname(host.c_str());
  ArduinoOTA.onStart([]() { Serial.println("[OTA] Update starting"); });
  ArduinoOTA.onEnd([]() { Serial.println("[OTA] Update complete"); });
  ArduinoOTA.onError([](ota_error_t err) { Serial.printf("[OTA] Error %u\n", err); });
  ArduinoOTA.begin();
  gOtaReady = true;
  Serial.printf("[OTA] Ready as %s (PlatformIO: esp32dev-ota + --upload-port <ip>)\n", host.c_str());
}

void syncTime() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  for (int i = 0; i < 20; i++) {
    time_t now = time(nullptr);
    if (now > 1700000000) {
      timeUtilMarkSynced();
      return;
    }
    vTaskDelay(pdMS_TO_TICKS(500));
  }
}

void fetchCardDeclared(const DeviceConfig& cfg, QueueHandle_t commandQ, const char* cardUid) {
  if (WiFi.status() != WL_CONNECTED || cardUid[0] == '\0') {
    return;
  }

  const String url = cfg.serverUrl + "/v1/card/" + cardUid + "?module=" + cfg.moduleType;
  HTTPClient http;
  WiFiClient client;
  if (!http.begin(client, url)) {
    return;
  }

  http.setTimeout(5000);
  const int code = http.GET();
  String body = http.getString();
  http.end();

  Command cmd{};
  cmd.type = CmdType::CARD_DECLARED;
  cmd.declaredPieces = 0;
  cmd.ppp = 0;

  if (code == 200) {
    JsonDocument doc;
    if (deserializeJson(doc, body) == DeserializationError::Ok) {
      cmd.declaredPieces = doc["declaredPieces"] | 0;
      cmd.ppp = doc["ppp"] | 0;
      Serial.printf("[NET] card %s declared=%lu pieces ppp=%lu\n", cardUid, cmd.declaredPieces,
                    cmd.ppp);
    }
  } else if (code == 404) {
    Serial.printf("[NET] card %s unassigned (404)\n", cardUid);
  } else {
    Serial.printf("[NET] card lookup failed HTTP %d\n", code);
  }

  xQueueSend(commandQ, &cmd, 0);
}

void netLoop(void* param) {
  auto* ctx = static_cast<NetContext*>(param);
  WiFiManagerTask wifi(ctx->cfg);
  OfflineStore store;
  store.begin();
  TelemetrySender sender(ctx->cfg, store, ctx->commandQ);
  OtaMgr ota(ctx->cfg, store);

  wifi.connect();
  syncTime();

  uint32_t lastHeartbeatMs = 0;
  uint32_t bootMs = millis();
  for (;;) {
    wifi.loop();

    if (wifi.isConnected()) {
      setupArduinoOta(ctx->cfg);
      ArduinoOTA.handle();
    }

    if (ctx->nodeState->load() == NodeState::REPROVISIONING) {
      DeviceConfig updated = ctx->cfg;
      if (Provisioning::runWifiOnly(updated, moduleTypeFromString(updated.moduleType)) ==
          Provisioning::Result::COMPLETE) {
        ESP.restart();
      }
    }

    TelemetryEvent ev{};
    while (xQueueReceive(ctx->telemetryQ, &ev, 0) == pdTRUE) {
      if (!sender.send(ev)) {
        // already pushed to offline store inside sender on failure
      }
    }

    uint8_t drainBudget = 4;
    if (!store.empty() && wifi.isConnected() && (millis() - bootMs) >= 5000) {
      while (drainBudget > 0) {
        TelemetryEvent queued{};
        if (!store.pop(queued)) {
          Serial.println("[NET] offline drain failed — queue reset");
          break;
        }
        drainBudget--;
        if (!sender.send(queued)) {
          store.push(queued);
          break;
        }
        if (store.empty()) {
          break;
        }
      }
    }

    const uint32_t now = millis();
    if ((now - lastHeartbeatMs) >= 15000) {
      const size_t depth = uxQueueMessagesWaiting(ctx->telemetryQ) + store.depth();
      uint32_t flags = store.overflow() ? 1 : 0;
      String hbResp;
      sender.sendHeartbeat(WiFi.RSSI(), now / 1000, depth, flags, &hbResp);
      lastHeartbeatMs = now;

      if (hbResp.length() > 0) {
        JsonDocument hbDoc;
        if (deserializeJson(hbDoc, hbResp) == DeserializationError::Ok) {
          if (!hbDoc["pendingOp"].isNull() && hbDoc["pendingOp"].is<JsonObject>()) {
            RemoteConfig::apply(hbDoc["pendingOp"].as<JsonObjectConst>());
          }
        }
      }
    }

    if (gForceOtaCheck.exchange(false)) {
      ota.forceCheck();
    }

    ota.handle(wifi.isConnected(), gSessionOpen.load());

    if (gCardLookup.pending.exchange(false) && wifi.isConnected()) {
      fetchCardDeclared(ctx->cfg, ctx->commandQ, gCardLookup.cardUid);
    }

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}
}  // namespace

void startNetTask(const DeviceConfig& cfg, QueueHandle_t telemetryQ, QueueHandle_t commandQ,
                  std::atomic<NodeState>& nodeState, uint32_t& seqCounter) {
  static NetContext ctx{cfg, telemetryQ, commandQ, &nodeState, &seqCounter};
  xTaskCreatePinnedToCore(netLoop, "NetTask", 16384, &ctx, 4, nullptr, 0);
}
