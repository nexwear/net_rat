#pragma once

#include "drivers/CounterDriver.h"
#include "drivers/CurrentDriver.h"
#include "drivers/HorseshoeIrDriver.h"

// INPUT piece counter — fuses the motor-current envelope with the horseshoe IR.
// After real sewing (peak >= MIN_PEAK_A held >= MIN_RUN_MS) a piece is counted when:
//   • the current falls to ~zero (full stop):  zero -> peak -> [min] -> zero, OR
//   • the horseshoe is lifted while still sewing (IR + current) — for continuous
//     feeders whose current never drops to zero between pieces.
// IR alone (a lift with no active sewing) never counts; PIECE_COOLDOWN_MS dedups a
// stop and a lift that mark the same boundary.
class InputPieceFusion : public CounterDriver {
 public:
  InputPieceFusion(CurrentDriver* current, HorseshoeIrDriver* horseshoe);
  void begin() override {}
  void poll() override;
  uint32_t total() const override { return _pieces; }
  DriverId id() const override { return DriverId::FUSION; }

 private:
  enum class Phase : uint8_t { IDLE, RUNNING, LOW_HOLD };

  void finishPiece(uint32_t now, const char* reason);
  bool tryCountPiece(uint32_t now, const char* reason);  // true if it counted (not in cooldown)
  void noteIrLift(uint32_t atMs);
  void resetCycle();

  CurrentDriver* _current;
  HorseshoeIrDriver* _ir;

  uint32_t _pieces = 0;
  uint32_t _lastPieceMs = 0;

  Phase _phase = Phase::IDLE;
  uint32_t _runStartMs = 0;
  uint32_t _lowHoldStartMs = 0;
  uint32_t _offSinceMs = 0;
  float _peakAmps = 0.0f;
  uint8_t _irLiftsThisCycle = 0;
  uint32_t _lastAmpsLogMs = 0;

  static constexpr float RUN_ON_A = 0.75f;
  static constexpr float RUN_OFF_A = 0.50f;
  static constexpr float IDLE_MIN_A = 0.28f;
  static constexpr float MIN_PEAK_A = 0.85f;
  static constexpr uint32_t MIN_OFF_MS = 100;
  static constexpr uint32_t MIN_RUN_MS = 120;
  static constexpr uint32_t PIECE_COOLDOWN_MS = 900;
  static constexpr uint32_t LOW_HOLD_MAX_MS = 20000;
  static constexpr uint32_t AMPS_LOG_MS = 250;  // throttle for the live current log
};
