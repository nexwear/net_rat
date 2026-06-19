#pragma once

#include "drivers/CounterDriver.h"
#include "drivers/CurrentDriver.h"
#include "drivers/HorseshoeIrDriver.h"

// INPUT station piece counter — fuses fast-sampled motor current with horseshoe IR.
//
// Patterns handled:
//   • Run → stop → lift horseshoe   (current 0→peak→0/low, IR break near run end)
//   • Run with 1–2 IR lifts in the window (elastic / adjust) → still one piece per run
//   • Lift after a recent run when current never fully hits zero (low plateau)
class InputPieceFusion : public CounterDriver {
 public:
  InputPieceFusion(CurrentDriver* current, HorseshoeIrDriver* horseshoe);
  void begin() override {}
  void poll() override;
  uint32_t total() const override { return _pieces; }
  DriverId id() const override { return DriverId::FUSION; }

 private:
  void onRunEnded(uint32_t now);
  void onIrLift(uint32_t atMs);
  void tryCountPiece(uint32_t now, const char* reason);
  bool hadRunNear(uint32_t ms) const;
  void recordRunEnd(uint32_t ms);

  CurrentDriver* _current;
  HorseshoeIrDriver* _ir;

  uint32_t _pieces = 0;
  uint32_t _lastPieceMs = 0;

  bool _running = false;
  uint32_t _runStartMs = 0;
  uint32_t _offSinceMs = 0;
  float _peakAmps = 0.0f;

  static constexpr uint8_t kRunHistory = 8;
  uint32_t _runEndMs[kRunHistory] = {};
  uint8_t _runEndHead = 0;

  static constexpr float RUN_ON_A = 0.75f;
  static constexpr float RUN_OFF_A = 0.50f;
  static constexpr float MIN_PEAK_A = 0.85f;
  static constexpr uint32_t MIN_OFF_MS = 100;
  static constexpr uint32_t MIN_RUN_MS = 120;
  static constexpr uint32_t PIECE_COOLDOWN_MS = 900;
  static constexpr uint32_t RUN_NEAR_MS = 10000;
};
