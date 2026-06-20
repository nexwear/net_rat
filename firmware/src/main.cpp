#include <Arduino.h>
#include <atomic>
#include <WiFi.h>
#include "DeviceConfig.h"
#include "prov/Provisioning.h"
#include "prov/SerialConfig.h"
#include "tasks/NetTask.h"
#include "tasks/SensingTask.h"
#include "core/RuntimeFlags.h"

static DeviceConfig gConfig;
static std::atomic<NodeState> gNodeState{NodeState::PROVISIONING};
static uint32_t gSeq = 0;

static QueueHandle_t telemetryQ;
static QueueHandle_t commandQ;

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("Grewbie garment-line node boot");

  ConfigStore::initMutex();  // serialize all NVS access before any task starts
  ConfigStore::loadSeq(gSeq);

  ConfigStore::load(gConfig);
  if (gConfig.valid) {
    ConfigStore::commitPendingFwVersion(gConfig);
  }

  if (!gConfig.valid) {
    if (ConfigStore::hasPendingProvision(gConfig)) {
      gNodeState.store(NodeState::PROVISIONING);
      if (Provisioning::resumeRegistration(gConfig) == Provisioning::Result::COMPLETE) {
        ESP.restart();
      }
      Serial.println("[PROV] Pending registration failed — opening setup portal");
    }
    gNodeState.store(NodeState::PROVISIONING);
    Serial.println("[PROV] No valid config — starting SoftAP setup portal");
    Serial.printf("[PROV] Connect to WiFi: %s  password: grewbie-setup\n",
                  Provisioning::apName(ModuleType::MOD_INPUT).c_str());
    Serial.println("[PROV] Open http://192.168.4.1/ in your browser");
    if (Provisioning::run(gConfig, ModuleType::MOD_INPUT) != Provisioning::Result::COMPLETE) {
      Serial.println("Provisioning failed — retry on next boot");
      delay(5000);
      ESP.restart();
    }
    ESP.restart();
  }

  gNodeState.store(NodeState::ACTIVE);
  const String runningFw =
      String(FW_VERSION) + (gConfig.fwVersion.length() ? String(" (nvs ") + gConfig.fwVersion + ")" : "");
  Serial.printf("[BOOT] ACTIVE — node %s module %s fw %s\n", gConfig.nodeId.c_str(),
                gConfig.moduleType.c_str(), runningFw.c_str());
  if (gConfig.wifi.size() > 0) {
    Serial.printf("[BOOT] WiFi target: %s\n", gConfig.wifi[0].ssid.c_str());
  }
  Serial.printf("[BOOT] Server: %s\n", gConfig.serverUrl.c_str());

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(WIFI_PS_NONE);

  telemetryQ = xQueueCreate(32, sizeof(TelemetryEvent));
  commandQ = xQueueCreate(16, sizeof(Command));
  gCardLookupQ = xQueueCreate(1, sizeof(CardLookupMsg));

  startNetTask(gConfig, telemetryQ, commandQ, gNodeState, gSeq);
  startSensingTask(gConfig, telemetryQ, commandQ, gNodeState, gSeq);
}

void loop() {
  // USB-serial control channel for the desktop configurator. Lets an already
  // provisioned node be re-configured or queried over the cable without the
  // SoftAP portal. CFG replaces wifi+server+module+label (token/nodeId kept).
  String line;
  if (SerialCfg::readLine(line)) {
    if (line == "STATUS") {
      SerialCfg::printStatus(gConfig, "ACTIVE");
    } else if (line == "RESET") {
      SerialCfg::printOk("factory reset — rebooting");
      Provisioning::factoryReset();
      delay(200);
      ESP.restart();
    } else if (line == "RECLAIM") {
      DeviceConfig cur;
      if (!ConfigStore::load(cur) || cur.wifi.empty()) {
        SerialCfg::printErr("not provisioned");
      } else {
        Serial.println("[CFG] RECLAIM — registering with server");
        if (Provisioning::reclaim(cur)) {
          gConfig = cur;
          SerialCfg::printOk("reclaimed");
        } else {
          SerialCfg::printErr("reclaim failed");
        }
      }
    } else if (line.startsWith("CFG ")) {
      DeviceConfig cur;
      ConfigStore::load(cur);  // preserve token / nodeId / line / factory
      if (SerialCfg::applyCfg(line, cur)) {
        if (ConfigStore::save(cur)) {
          SerialCfg::printOk("config saved — rebooting");
          delay(200);
          ESP.restart();
        } else {
          SerialCfg::printErr("nvs save failed");
        }
      }
    }
  }
  vTaskDelay(pdMS_TO_TICKS(50));
}
