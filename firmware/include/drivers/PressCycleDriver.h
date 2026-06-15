#pragma once

#include "drivers/CounterDriver.h"

// Heat-press station (OUTPUT_2) — the most accurate count on the line.
//
// Two active-HIGH IR sensors (read HIGH when an object is detected):
//   clothPin : garment present on the platen
//   pressPin : press head has come down
//
// One piece is counted only when a press stroke completes — the press is held
// down for at least MIN_DWELL_MS (real heat time) WITH cloth present — then
// lifts. Empty presses (no cloth) and momentary taps (no dwell) are ignored.
class PressCycleDriver : public CounterDriver {
 public:
  PressCycleDriver(uint8_t clothPin, uint8_t pressPin);
  void begin() override;
  void poll() override;
  uint32_t total() const override { return _total; }
  DriverId id() const override { return DriverId::PRESS; }

 private:
  enum class State : uint8_t { IDLE, PRESSING };

  uint8_t _clothPin;
  uint8_t _pressPin;
  uint32_t _total = 0;
  State _state = State::IDLE;
  uint32_t _pressStartMs = 0;
  bool _hadCloth = false;

  // press-signal debounce
  bool _pressRaw = false;
  bool _pressStable = false;
  uint32_t _pressEdgeMs = 0;

  static constexpr uint32_t DEBOUNCE_MS = 40;
  static constexpr uint32_t MIN_DWELL_MS = 1000;  // minimum heat-press hold
};
