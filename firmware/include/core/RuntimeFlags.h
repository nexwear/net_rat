#pragma once

#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>

inline std::atomic<bool> gSessionOpen{false};
inline std::atomic<bool> gOtaActive{false};
inline std::atomic<bool> gForceOtaCheck{false};
// True until NetTask finishes the first cloud session resume attempt after boot.
// Blocks NFC tap-in so a card read cannot open a fresh pass=0 session before
// OUTPUT/INPUT counts are restored from the cloud row.
inline std::atomic<bool> gBootSessionGate{true};

// Task handles, published by each task at startup so the heartbeat can report
// per-task stack headroom (uxTaskGetStackHighWaterMark) for field monitoring.
inline TaskHandle_t gNetTaskHandle = nullptr;
inline TaskHandle_t gSensingTaskHandle = nullptr;
inline TaskHandle_t gCurrentTaskHandle = nullptr;

// Liveness heartbeat for the sensing/NFC loop: SensingTask stamps millis() at the
// end of every iteration. NetTask reboots the node if this stops advancing, which
// recovers a wedged PN5180 (a blocking SPI call that hangs the loop) even though
// SensingTask is intentionally NOT on the shared task-WDT (its recovery delays
// used to trip it). 0 = sensing not started yet (no reboot during boot).
inline std::atomic<uint32_t> gSensingAliveMs{0};

// Card-lookup request: SensingTask hands the tapped UID to NetTask, which does
// the server declared/ppp lookup. A length-1 queue (written with xQueueOverwrite,
// "latest tap wins") replaces a shared char buffer — no torn reads across tasks,
// and the request now survives until NetTask is online to consume it (an offline
// tap previously cleared the pending flag and dropped the lookup entirely).
struct CardLookupMsg {
  char cardUid[24];
};

inline QueueHandle_t gCardLookupQ = nullptr;
