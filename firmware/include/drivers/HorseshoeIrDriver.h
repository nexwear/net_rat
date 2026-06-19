#pragma once

#include "drivers/CounterDriver.h"

// Horseshoe IR beam-break sensor at the piece pass-through.
// A single piece may break the beam several times (e.g. the elastic operation:
// once to stitch the elastic, once to attach it to the fabric). To avoid
// over-counting we GROUP all breaks that occur within GROUP_GAP_MS into one
// piece. total() therefore returns windowed piece-groups, not raw breaks.
class HorseshoeIrDriver : public CounterDriver {
 public:
  explicit HorseshoeIrDriver(uint8_t pin);
  void begin() override;
  void poll() override;
  uint32_t total() const override { return _groups; }  // windowed piece-groups
  uint32_t rawBreaks() const { return _rawBreaks; }
  // Beam cleared after a real block — used by INPUT current+IR fusion (no 1 s minimum).
  bool consumeLiftEvent(uint32_t& atMs);
  DriverId id() const override { return DriverId::HORSESHOE; }

 private:
  enum class State : uint8_t { IDLE, BLOCKED, CONFIRMED };

  void registerBreak();

  uint8_t _pin;
  uint32_t _groups = 0;
  uint32_t _rawBreaks = 0;
  uint32_t _lastBreakMs = 0;
  uint32_t _cycleStartMs = 0;
  State _state = State::IDLE;
  uint32_t _stateMs = 0;
  bool _lastRaw = true;
  bool _pendingLift = false;
  uint32_t _pendingLiftMs = 0;

  static constexpr uint32_t DEBOUNCE_MS = 30;
  static constexpr uint32_t MIN_BLOCK_MS = 150;
  // Full block→clear cycles shorter than this are a quick lift/bump — not a piece.
  static constexpr uint32_t MIN_PIECE_MS = 1000;
  // Breaks within this window of each other count as a single piece.
  static constexpr uint32_t GROUP_GAP_MS = 1200;
};
