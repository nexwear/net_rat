#include <Arduino.h>
#include <atomic>
#include "DeviceConfig.h"
#include "prov/Provisioning.h"
#include "tasks/NetTask.h"
#include "tasks/SensingTask.h"

static DeviceConfig gConfig;
static std::atomic<NodeState> gNodeState{NodeState::PROVISIONING};
static uint32_t gSeq = 0;

static QueueHandle_t telemetryQ;
static QueueHandle_t commandQ;

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("Grewbie garment-line node boot");

  ConfigStore::loadSeq(gSeq);

  if (ConfigStore::load(gConfig)) {
    ConfigStore::commitPendingFwVersion(gConfig);
  }

  if (!gConfig.valid) {
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

  telemetryQ = xQueueCreate(32, sizeof(TelemetryEvent));
  commandQ = xQueueCreate(8, sizeof(Command));

  startNetTask(gConfig, telemetryQ, commandQ, gNodeState, gSeq);
  startSensingTask(gConfig, telemetryQ, commandQ, gNodeState, gSeq);
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}
