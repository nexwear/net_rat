#include "tasks/SensingTask.h"
#include "drivers/BuzzerDriver.h"
#include "drivers/CurrentDriver.h"
#include "drivers/HallDriver.h"
#include "drivers/HorseshoeIrDriver.h"
#include "drivers/PressCycleDriver.h"
#include "drivers/InputPieceFusion.h"
#include "pins.h"
#include "prov/Provisioning.h"
#include "nfc/NfcSubsystem.h"
#include "session/SessionManager.h"
#include "core/RuntimeFlags.h"

namespace {
struct SensingContext {
  DeviceConfig cfg;
  QueueHandle_t telemetryQ;
  QueueHandle_t commandQ;
  std::atomic<NodeState>* nodeState;
  uint32_t* seqCounter;
};

void sensingLoop(void* param) {
  auto* ctx = static_cast<SensingContext*>(param);
  const ModuleType moduleType = moduleTypeFromString(ctx->cfg.moduleType);
  const pins::PinMap pinMap = pins::forModule(moduleType);

  std::vector<CounterDriver*> drivers;
  HorseshoeIrDriver horseshoeDriver(static_cast<uint8_t>(pinMap.horseshoeIr));
  CurrentDriver currentDriver(static_cast<uint8_t>(pinMap.currentAdc));
  HallDriver hallDriver(static_cast<uint8_t>(pinMap.hall));
  PressCycleDriver pressDriver(static_cast<uint8_t>(pinMap.irCloth),
                               static_cast<uint8_t>(pinMap.irPress));
  InputPieceFusion fusionDriver(&currentDriver, &horseshoeDriver);

  if (pinMap.horseshoeIr >= 0) drivers.push_back(&horseshoeDriver);
  if (pinMap.currentAdc >= 0) drivers.push_back(&currentDriver);
  if (pinMap.hall >= 0) drivers.push_back(&hallDriver);
  if (pinMap.irCloth >= 0 && pinMap.irPress >= 0) drivers.push_back(&pressDriver);
  if (moduleType == ModuleType::MOD_INPUT && pinMap.horseshoeIr >= 0 && pinMap.currentAdc >= 0) {
    drivers.push_back(&fusionDriver);
  }

  for (auto* d : drivers) {
    d->begin();
  }

  BuzzerDriver buzzer(pinMap.buzzer);
  buzzer.begin();

  NfcSubsystem nfc(pinMap);
  if (!nfc.begin()) {
    Serial.println("[NFC] init failed — card reads disabled until reboot");
  }
  nfc.setAssignMode(moduleType == ModuleType::ADMIN);

  SessionManager sessions(ctx->cfg, drivers, ctx->telemetryQ, ctx->seqCounter, &buzzer);
  nfc.onTap([&sessions](const char* uid) { sessions.onTap(uid); });

  pinMode(pinMap.configButton, INPUT_PULLUP);
  pinMode(pinMap.statusLed, OUTPUT);
  uint32_t buttonDownMs = 0;
  uint32_t adminLedUntilMs = 0;
  uint32_t adminHeartbeatMs = 0;
  bool adminHeartbeatOn = false;

  TickType_t lastWake = xTaskGetTickCount();
  for (;;) {
    for (auto* d : drivers) {
      d->poll();
    }
    buzzer.poll();
    nfc.pollRead();
    sessions.tick();

    Command cmd{};
    if (xQueueReceive(ctx->commandQ, &cmd, 0) == pdTRUE) {
      if (cmd.type == CmdType::REPROVISION && !sessions.hasOpenSession()) {
        ctx->nodeState->store(NodeState::REPROVISIONING);
      } else if (cmd.type == CmdType::CARD_DECLARED) {
        if (!cmd.cardAssigned) {
          sessions.abortUnassignedSession();
        } else {
          sessions.setPpp(cmd.ppp);
          sessions.setDeclaredPieces(cmd.declaredPieces);
        }
      } else if (cmd.type == CmdType::SESSION_SYNC) {
        sessions.setCloudSessionId(cmd.sessionId);
      } else if (cmd.type == CmdType::SESSION_RESUME) {
        sessions.resumeSession(cmd.cardUid, cmd.sessionId, cmd.resumePass, cmd.resumeCycle,
                               cmd.declaredPieces, cmd.ppp, cmd.resumeStartEpochMs);
      } else if (cmd.type == CmdType::ADMIN_SCAN_FEEDBACK) {
        nfc.onAssignFeedback();
        if (cmd.cardNumber > 0) {
          buzzer.play(cmd.newlyRegistered ? BuzzPattern::ADMIN_NEW : BuzzPattern::ADMIN_EXISTS);
          adminLedUntilMs = millis() + (cmd.newlyRegistered ? 450U : 250U);
        }
      }
    }

    const bool buttonPressed = !digitalRead(pinMap.configButton);
    if (buttonPressed) {
      if (buttonDownMs == 0) {
        buttonDownMs = millis();
      } else if ((millis() - buttonDownMs) >= 10000) {
        Provisioning::factoryReset();
        ESP.restart();
      } else if ((millis() - buttonDownMs) >= 3000 && !sessions.hasOpenSession()) {
        Serial.println("[PROV] BOOT 3s — WiFi reprovision (SoftAP starting after reboot)");
        ctx->nodeState->store(NodeState::REPROVISIONING);
      }
    } else {
      buttonDownMs = 0;
    }

    if (gOtaActive.load()) {
      // LED blinks rapidly during production OTA (handled in OtaMgr)
    } else if (moduleType == ModuleType::ADMIN) {
      const uint32_t nowMs = millis();
      if (nowMs < adminLedUntilMs) {
        digitalWrite(pinMap.statusLed, HIGH);
      } else if (nfc.assignListening()) {
        if ((nowMs - adminHeartbeatMs) >= 2500) {
          adminHeartbeatMs = nowMs;
          adminHeartbeatOn = !adminHeartbeatOn;
        }
        digitalWrite(pinMap.statusLed, adminHeartbeatOn ? HIGH : LOW);
      } else {
        digitalWrite(pinMap.statusLed, LOW);
      }
    } else if (sessions.hasOpenSession()) {
      digitalWrite(pinMap.statusLed, HIGH);
    } else {
      digitalWrite(pinMap.statusLed, LOW);
    }

    vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(10));
  }
}
}  // namespace

void startSensingTask(const DeviceConfig& cfg, QueueHandle_t telemetryQ, QueueHandle_t commandQ,
                      std::atomic<NodeState>& nodeState, uint32_t& seqCounter) {
  static SensingContext ctx{cfg, telemetryQ, commandQ, &nodeState, &seqCounter};
  xTaskCreatePinnedToCore(sensingLoop, "SensingTask", 12288, &ctx, 5, &gSensingTaskHandle, 1);
}
