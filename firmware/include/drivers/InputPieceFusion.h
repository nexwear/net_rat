#pragma once

#include "drivers/CounterDriver.h"
#include "drivers/CurrentDriver.h"
#include "drivers/HorseshoeIrDriver.h"

// INPUT piece counter — current envelope is the primary signal; IR never counts alone.
//
// Counted patterns (current only, or current confirmed by IR lift in same window):
//   • zero → peak → zero
//   • zero → peak → min (low plateau) → zero
//   • min → zero after a prior peak (continuation of the same sew cycle)
// IR lifts are tracked for logging but never increment count without a current run end.
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
  void tryCountPiece(uint32_t now, const char* reason);
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

  static constexpr float RUN_ON_A = 0.75f;
  static constexpr float RUN_OFF_A = 0.50f;
  static constexpr float IDLE_MIN_A = 0.28f;
  static constexpr float MIN_PEAK_A = 0.85f;
  static constexpr uint32_t MIN_OFF_MS = 100;
  static constexpr uint32_t MIN_RUN_MS = 120;
  static constexpr uint32_t PIECE_COOLDOWN_MS = 900;
  static constexpr uint32_t LOW_HOLD_MAX_MS = 20000;
};
