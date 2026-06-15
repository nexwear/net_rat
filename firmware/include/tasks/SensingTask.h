#pragma once

#include "DeviceConfig.h"
#include "session/SessionManager.h"
#include "nfc/NfcSubsystem.h"
#include "drivers/CounterDriver.h"
#include "types.h"
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <vector>

void startSensingTask(const DeviceConfig& cfg, QueueHandle_t telemetryQ, QueueHandle_t commandQ,
                        std::atomic<NodeState>& nodeState, uint32_t& seqCounter);
