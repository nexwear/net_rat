#pragma once

#include "drivers/CounterDriver.h"
#include "drivers/CurrentDriver.h"
#include "drivers/HorseshoeIrDriver.h"

// INPUT piece counter — current-burst detection (no IR required).
// The machine is a continuous clutch/servo motor: current idles ~1 A and each
// piece is a high-current sewing burst (peaks ~10–30 A). One burst = one piece:
// amps rise above RUN_ON_A, then fall back to the idle band (below IDLE_MIN_A) for
// MIN_OFF_MS, with peak >= MIN_PEAK_A and run >= MIN_RUN_MS. Horseshoe IR lifts
// are logged (+ir=N) for reference but do NOT affect the count.
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

  // Tuned to this machine's signature: idle/between-pieces ~0.7–1.5 A, a sewing
  // burst peaks ~10–30 A. A piece = one burst; no full stop needed, so IR is not
  // required. Retune these if a different machine/garment draws differently.
  static constexpr float RUN_ON_A = 3.0f;    // enter "sewing" (well above idle band)
  static constexpr float RUN_OFF_A = 2.5f;   // leaving the burst
  static constexpr float IDLE_MIN_A = 2.0f;  // back in the idle band ⇒ piece ended
  static constexpr float MIN_PEAK_A = 5.0f;  // a real piece peaks far above idle
  static constexpr uint32_t MIN_OFF_MS = 250;   // idle band must hold to end a piece
  static constexpr uint32_t MIN_RUN_MS = 120;
  static constexpr uint32_t PIECE_COOLDOWN_MS = 900;
  static constexpr uint32_t LOW_HOLD_MAX_MS = 20000;
  static constexpr uint32_t AMPS_LOG_MS = 250;  // throttle for the live current log
};
