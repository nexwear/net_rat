#pragma once

#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

inline std::atomic<bool> gSessionOpen{false};
inline std::atomic<bool> gOtaActive{false};
inline std::atomic<bool> gForceOtaCheck{false};

// Task handles, published by each task at startup so the heartbeat can report
// per-task stack headroom (uxTaskGetStackHighWaterMark) for field monitoring.
inline TaskHandle_t gNetTaskHandle = nullptr;
inline TaskHandle_t gSensingTaskHandle = nullptr;
inline TaskHandle_t gCurrentTaskHandle = nullptr;

struct CardLookupRequest {
  std::atomic<bool> pending{false};
  char cardUid[24] = "";
};

inline CardLookupRequest gCardLookup;
