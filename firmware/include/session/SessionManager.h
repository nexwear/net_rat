#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <vector>
#include "DeviceConfig.h"
#include "drivers/CounterDriver.h"
#include "types.h"

class SessionManager {
 public:
  SessionManager(const DeviceConfig& cfg, std::vector<CounterDriver*>& drivers, QueueHandle_t telemetryQ,
                 uint32_t* seqCounter);

  void onTap(const char* cardUid, ScanKind kindOverride = ScanKind::TAP_IN);
  void tick();
  void setDeclaredPieces(uint32_t pieces);
  bool hasOpenSession() const { return _activeCardUid[0] != '\0'; }
  const char* activeCardUid() const { return _activeCardUid; }

 private:
  struct Baseline {
    bool used = false;
    uint32_t value = 0;
  };

  const DeviceConfig& _cfg;
  std::vector<CounterDriver*>& _drivers;
  QueueHandle_t _telemetryQ;
  uint32_t* _seqCounter;

  char _activeCardUid[24] = "";
  char _sessionId[37] = "";
  char _lastTapUid[24] = "";
  uint32_t _startMs = 0;
  uint32_t _lastEmitMs = 0;
  uint32_t _lastTapMs = 0;
  uint32_t _unassignedPass = 0;
  uint32_t _unassignedCycle = 0;
  uint32_t _lastUnassignedEmitMs = 0;
  Baseline _baseline[4]{};

  uint32_t deltaFor(DriverId id) const;
  uint32_t passCount() const;
  uint32_t cycleCount() const;
  float liveAmps() const;
  void snapshotBaselines();
  void openSession(const char* cardUid, ScanKind kind);
  void closeSession(CloseReason reason, ScanKind scanKind = ScanKind::AUTO_CLOSE);
  void emit(TelemetryType type, ScanKind scanKind = ScanKind::TAP_IN, CloseReason reason = CloseReason::TIMEOUT);
  bool deltaChangedBy(uint32_t k);
  uint32_t unassignedPassCount() const;
  uint32_t unassignedCycleCount() const;
  uint32_t _lastReportedPass = 0;
  uint32_t _lastReportedCycle = 0;
  uint32_t _unassignedBaselinePass = 0;
  uint32_t _unassignedBaselineCycle = 0;
  uint32_t _cachedDeclared = 0;
  uint32_t _qtyReachedMs = 0;

  static constexpr uint32_t TAP_OUT_WINDOW_MS = 2500;
  static constexpr uint32_t SESSION_UPDATE_MS = 10000;
  static constexpr uint32_t SESSION_TIMEOUT_MS = 45UL * 60UL * 1000UL;
  static constexpr uint32_t UNASSIGNED_EMIT_MS = 30000;
  static constexpr uint32_t DELTA_EMIT_THRESHOLD = 5;
  static constexpr uint32_t QTY_GRACE_MS = 3000;
};
