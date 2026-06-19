#pragma once

#include "drivers/CounterDriver.h"

// Horseshoe IR beam-break sensor at the piece pass-through (active LOW = blocked).
// INPUT: fast lift edges for current+IR fusion; groups use a 1 s minimum dwell.
// OUTPUT_1: strict piece cycle — blocked ~2.5 s then clear ~1.25 s, with glitch filtering.
class HorseshoeIrDriver : public CounterDriver {
 public:
  enum class PieceCountMode : uint8_t { INPUT_LIFT, OUTPUT_STRICT };

  explicit HorseshoeIrDriver(uint8_t pin);
  void begin() override;
  void poll() override;
  void setPieceCountMode(PieceCountMode mode) { _mode = mode; }
  uint32_t total() const override { return _groups; }
  uint32_t rawBreaks() const { return _rawBreaks; }
  // Beam cleared after a real block — used by INPUT current+IR fusion (no 1 s minimum).
  bool consumeLiftEvent(uint32_t& atMs);
  DriverId id() const override { return DriverId::HORSESHOE; }

 private:
  enum class State : uint8_t { IDLE, BLOCKED, CONFIRMED };
  enum class OutState : uint8_t { CLEAR, BLOCKED, CLEARING };

  void registerBreak();
  void pollInputLift();
  void pollOutputStrict();

  uint8_t _pin;
  PieceCountMode _mode = PieceCountMode::INPUT_LIFT;
  uint32_t _groups = 0;
  uint32_t _rawBreaks = 0;
  uint32_t _lastBreakMs = 0;
  uint32_t _cycleStartMs = 0;
  State _state = State::IDLE;
  uint32_t _stateMs = 0;
  bool _lastRaw = true;
  bool _pendingLift = false;
  uint32_t _pendingLiftMs = 0;

  // OUTPUT_1 debounced stable beam reading (true = blocked / beam broken).
  bool _outStableBlocked = false;
  bool _outCandidateBlocked = false;
  uint32_t _outCandidateMs = 0;
  OutState _outState = OutState::CLEAR;
  uint32_t _outBlockStartMs = 0;
  uint32_t _outClearStartMs = 0;
  bool _outBlockQualified = false;

  static constexpr uint32_t DEBOUNCE_MS = 30;
  static constexpr uint32_t MIN_BLOCK_MS = 150;
  static constexpr uint32_t MIN_PIECE_MS = 1000;
  static constexpr uint32_t GROUP_GAP_MS = 1200;

  // OUTPUT_1: ignore sub-350 ms opposite glitches while blocked or clearing.
  static constexpr uint32_t OUT_GLITCH_MS = 350;
  // Must stay blocked ~2–3 s before a release can count as a piece.
  static constexpr uint32_t OUT_MIN_BLOCK_MS = 2500;
  // Must stay clear ~1–1.5 s after a qualified block to register one piece.
  static constexpr uint32_t OUT_MIN_CLEAR_MS = 1250;
};
