#pragma once

#include "DeviceConfig.h"
#include "types.h"
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <atomic>

void startNetTask(const DeviceConfig& cfg, QueueHandle_t telemetryQ, QueueHandle_t commandQ,
                  std::atomic<NodeState>& nodeState, uint32_t& seqCounter);
