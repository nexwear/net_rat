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
#include <esp_task_wdt.h>
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

// Mark the clock synced as soon as NTP has produced a plausible epoch. Cheap,
// non-blocking — safe to call every loop iteration.
bool maybeMarkTimeSynced() {
  if (timeUtilIsSynced()) {
    return true;
  }
  if (time(nullptr) > 1700000000) {
    timeUtilMarkSynced();
    Serial.println("[NET] clock synced");
    return true;
  }
  return false;
}

// Boot-time best-effort NTP sync. Bounded (≤6s) so a missing internet uplink
// never stalls startup — the net loop keeps retrying afterwards.
void syncTime() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  for (int i = 0; i < 12; i++) {
    if (maybeMarkTimeSynced()) {
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

  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  const int code = http.GET();
  String body = http.getString();
  http.end();

  Command cmd{};
  cmd.type = CmdType::CARD_DECLARED;
  cmd.declaredPieces = 0;
  cmd.ppp = 0;
  cmd.cardAssigned = false;

  if (code == 200) {
    JsonDocument doc;
    if (deserializeJson(doc, body) == DeserializationError::Ok) {
      cmd.declaredPieces = doc["declaredPieces"] | 0;
      cmd.ppp = doc["ppp"] | 0;
      cmd.cardAssigned = true;
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

void tryResumeActiveSession(const DeviceConfig& cfg, QueueHandle_t commandQ) {
  if (cfg.moduleType == "ADMIN" || gSessionOpen.load()) {
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  const String url = cfg.serverUrl + "/v1/session/active";
  HTTPClient http;
  WiFiClient client;
  if (!http.begin(client, url)) {
    return;
  }

  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  http.addHeader("X-Node-Token", cfg.token);
  const int code = http.GET();
  const String body = http.getString();
  http.end();

  if (code != 200) {
    if (code != 404) {
      Serial.printf("[NET] session resume lookup HTTP %d\n", code);
    }
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok || !(doc["active"] | false)) {
    return;
  }

  const char* cardUid = doc["cardUid"] | "";
  const char* sessionId = doc["sessionId"] | "";
  if (cardUid[0] == '\0' || sessionId[0] == '\0') {
    return;
  }

  Command cmd{};
  cmd.type = CmdType::SESSION_RESUME;
  strncpy(cmd.cardUid, cardUid, sizeof(cmd.cardUid) - 1);
  strncpy(cmd.sessionId, sessionId, sizeof(cmd.sessionId) - 1);
  cmd.resumePass = doc["countPass"] | 0;
  cmd.resumeCycle = doc["countCycle"] | 0;
  cmd.declaredPieces = doc["declaredPieces"] | 0;
  cmd.ppp = doc["ppp"] | 0;
  cmd.resumeStartEpochMs = doc["startTs"] | 0ULL;

  if (cmd.resumeStartEpochMs > 0) {
    bool tsValid = false;
    const uint64_t nowMs = epochMsNow(&tsValid);
    if (tsValid && nowMs > cmd.resumeStartEpochMs &&
        (nowMs - cmd.resumeStartEpochMs) > (45ULL * 60ULL * 1000ULL)) {
      Serial.println("[NET] stale cloud session ignored — tap card to start fresh");
      return;
    }
  }

  if (xQueueSend(commandQ, &cmd, pdMS_TO_TICKS(200)) == pdTRUE) {
    Serial.printf("[NET] resuming cloud session %s card %s pass=%lu cycle=%lu\n", sessionId,
                  cardUid, cmd.resumePass, cmd.resumeCycle);
  } else {
    Serial.println("[NET] session resume command queue full");
  }
}

void netLoop(void* param) {
  auto* ctx = static_cast<NetContext*>(param);
  WiFiManagerTask wifi(ctx->cfg);
  OfflineStore store;
  store.begin();
  store.purgeStaleSessionEvents();
  TelemetrySender sender(ctx->cfg, store, ctx->commandQ);
  OtaMgr ota(ctx->cfg, store);

  // Kick off the (non-blocking) connection, then give it a short bounded window
  // to associate so NTP can sync before the first heartbeat. If WiFi isn't up in
  // time we proceed anyway — the loop keeps reconnecting and re-syncing.
  wifi.connect();
  const uint32_t connectDeadline = millis() + 12000;
  while (!wifi.isConnected() && millis() < connectDeadline) {
    wifi.loop();
    vTaskDelay(pdMS_TO_TICKS(50));
  }
  syncTime();

  // Last-resort liveness watchdog, scoped to THIS task only (not the sensing /
  // NFC task, whose watchdog was removed because PN5180 recovery tripped it).
  // Generous 300s timeout: every network call here is already timeout-bounded,
  // and the longest single iteration (an OTA download) self-limits via its 45s
  // idle timeout — so this only ever fires on a genuine permanent hang, after
  // which a reboot is the right recovery. A WDT reboot mid-OTA is safe: Update
  // only commits on completion, so the node falls back to the running image.
  esp_task_wdt_init(300, true);
  esp_task_wdt_add(nullptr);

  uint32_t lastHeartbeatMs = 0;
  uint32_t lastTimeSyncMs = millis();
  uint32_t bootMs = millis();
  bool bootSyncDone = false;
  bool sessionResumeDone = false;
  for (;;) {
    esp_task_wdt_reset();
    wifi.loop();

    // Keep retrying NTP until the clock is valid (e.g. internet arrived after
    // boot). Non-blocking: configTime() kicks off SNTP, success is detected on a
    // later iteration. Avoids a reboot just to get a valid timestamp.
    if (!timeUtilIsSynced() && wifi.isConnected()) {
      maybeMarkTimeSynced();
      if (millis() - lastTimeSyncMs >= 60000) {
        lastTimeSyncMs = millis();
        configTime(0, 0, "pool.ntp.org", "time.nist.gov");
      }
    }

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

    const uint32_t now = millis();

    // Boot heartbeat, then pull any open cloud session into RAM (reboot recovery).
    if (wifi.isConnected() && !bootSyncDone) {
      const size_t depth = uxQueueMessagesWaiting(ctx->telemetryQ) + store.depth();
      uint32_t flags = store.overflow() ? 1 : 0;
      String hbResp;
      sender.sendHeartbeat(WiFi.RSSI(), now / 1000, depth, flags, &hbResp);
      lastHeartbeatMs = now;
      bootSyncDone = true;
      Serial.println("[NET] boot heartbeat sent");

      if (hbResp.length() > 0) {
        JsonDocument hbDoc;
        if (deserializeJson(hbDoc, hbResp) == DeserializationError::Ok) {
          if (!hbDoc["pendingOp"].isNull() && hbDoc["pendingOp"].is<JsonObject>()) {
            RemoteConfig::apply(hbDoc["pendingOp"].as<JsonObjectConst>());
          }
        }
      }

      if (!sessionResumeDone) {
        tryResumeActiveSession(ctx->cfg, ctx->commandQ);
        sessionResumeDone = true;
      }
    }

    uint8_t drainBudget = 4;
    if (!store.empty() && wifi.isConnected() && bootSyncDone && (now - bootMs) >= 2000) {
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
      // Snapshot the shared UID locally before the (millisecond-scale) HTTP call
      // so a concurrent tap on the sensing task can't tear the buffer mid-read.
      char uid[sizeof(gCardLookup.cardUid)];
      strncpy(uid, gCardLookup.cardUid, sizeof(uid) - 1);
      uid[sizeof(uid) - 1] = '\0';
      fetchCardDeclared(ctx->cfg, ctx->commandQ, uid);
    }

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}
}  // namespace

void startNetTask(const DeviceConfig& cfg, QueueHandle_t telemetryQ, QueueHandle_t commandQ,
                  std::atomic<NodeState>& nodeState, uint32_t& seqCounter) {
  static NetContext ctx{cfg, telemetryQ, commandQ, &nodeState, &seqCounter};
  xTaskCreatePinnedToCore(netLoop, "NetTask", 16384, &ctx, 4, &gNetTaskHandle, 0);
}
