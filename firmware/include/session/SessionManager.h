#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <vector>
#include "DeviceConfig.h"
#include "drivers/CounterDriver.h"
#include "drivers/BuzzerDriver.h"
#include "types.h"

class SessionManager {
 public:
  SessionManager(const DeviceConfig& cfg, std::vector<CounterDriver*>& drivers, QueueHandle_t telemetryQ,
                 uint32_t* seqCounter, BuzzerDriver* buzzer = nullptr);

  void onTap(const char* cardUid, ScanKind kindOverride = ScanKind::TAP_IN);
  void tick();
  void setDeclaredPieces(uint32_t pieces);
  void setPpp(uint32_t ppp);  // pulses-per-piece pushed from server for this bundle
  void resumeSession(const char* cardUid, const char* sessionId, uint32_t pass, uint32_t cycle,
                     uint32_t declared, uint32_t ppp, uint64_t startEpochMs);
  void syncFromCloud(const char* sessionId, uint32_t pass, uint32_t cycle, uint32_t declared);
  /** Resume or re-sync from heartbeat / UPDATE ack (opens session if none local). */
  void applyCloudSession(const char* sessionId, const char* cardUid, uint32_t pass,
                         uint32_t cycle, uint32_t declared, uint32_t ppp,
                         uint64_t startEpochMs = 0);
  void setCloudSessionId(const char* sessionId);
  void abortUnassignedSession();
  bool hasOpenSession() const { return _activeCardUid[0] != '\0'; }
  const char* activeCardUid() const { return _activeCardUid; }

 private:
  struct Baseline {
    bool used = false;
    uint32_t value = 0;    // driver.total() snapshot at session start (subtracted)
    uint32_t offset = 0;   // resumed/cloud count added back, so the reported count
                           // continues from the cloud value after a reboot/resync
  };

  const DeviceConfig& _cfg;
  std::vector<CounterDriver*>& _drivers;
  QueueHandle_t _telemetryQ;
  uint32_t* _seqCounter;
  BuzzerDriver* _buzzer;

  char _activeCardUid[24] = "";
  char _sessionId[37] = "";
  char _lastTapUid[24] = "";
  uint32_t _startMs = 0;
  uint32_t _lastEmitMs = 0;
  uint32_t _lastTapMs = 0;
  uint32_t _unassignedPass = 0;
  uint32_t _unassignedCycle = 0;
  uint32_t _lastUnassignedEmitMs = 0;
  Baseline _baseline[5]{};

  uint32_t deltaFor(DriverId id) const;
  uint32_t passCount() const;
  uint32_t cycleCount() const;
  uint32_t rotationDelta() const;        // hall rotations this session (raw work)
  uint32_t horseshoeGroups() const;      // windowed piece-groups this session
  uint32_t quantumEstimate() const;      // rotations / ppp
  void updateLiveCalibration();          // refine _ppp from lifters mid-session
  float liveAmps() const;
  void snapshotBaselines();
  void adjustBaselinesForResume(uint32_t targetPass, uint32_t targetCycle);
  // Raise one driver's reported delta up to `target` if it is currently below it.
  // Never lowers a live count — the cloud is a recovery floor after a reboot, not
  // an authority that can roll back local progress.
  void raiseBaseline(DriverId id, uint32_t target);
  void openSession(const char* cardUid, ScanKind kind);
  void closeSession(CloseReason reason, ScanKind scanKind = ScanKind::AUTO_CLOSE);
  void emit(TelemetryType type, ScanKind scanKind = ScanKind::TAP_IN, CloseReason reason = CloseReason::TIMEOUT,
            const char* cardUidOverride = nullptr);
  bool deltaChangedBy(uint32_t k);
  uint32_t unassignedPassCount() const;
  uint32_t unassignedCycleCount() const;
  uint32_t _lastReportedPass = 0;
  uint32_t _lastReportedCycle = 0;
  uint32_t _unassignedBaselinePass = 0;
  uint32_t _unassignedBaselineCycle = 0;
  uint32_t _cachedDeclared = 0;
  uint32_t _qtyReachedMs = 0;
  float _ppp = DEFAULT_PPP;  // pulses-per-piece, calibrated per style+size

  static constexpr uint32_t TAP_OUT_WINDOW_MS = 2500;
  static constexpr uint32_t SESSION_UPDATE_MS = 60000;  // keepalive only; counts emit on change
  // Sessions/bundles can stay open for days (a worker may keep one card on a
  // bundle across shifts). Only auto-close after a full week of no tap-out, as a
  // last-resort cleanup for a card that was simply abandoned.
  static constexpr uint32_t SESSION_TIMEOUT_MS = 7UL * 24UL * 60UL * 60UL * 1000UL;
  static constexpr uint32_t UNASSIGNED_EMIT_MS = 30000;
  static constexpr uint32_t DELTA_EMIT_THRESHOLD = 1;
  static constexpr uint32_t QTY_GRACE_MS = 3000;

  // Counting / calibration
  static constexpr float    DEFAULT_PPP = 400.0f;  // bootstrap before server data
  static constexpr float    MIN_PPP = 20.0f;       // sanity clamp
  static constexpr float    MAX_PPP = 20000.0f;
  static constexpr uint32_t CALIB_MIN_GROUPS = 4;  // groups needed to trust a live sample
  static constexpr float    CALIB_BLEND = 0.15f;   // weight of each live sample
};
