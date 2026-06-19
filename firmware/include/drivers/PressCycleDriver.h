#pragma once

#include "drivers/CounterDriver.h"

// Heat-press station (OUTPUT_2) — single active-HIGH IR on the press stroke.
//
// pressPin reads HIGH when the press head is down. One piece is counted when
// the press is held for at least MIN_DWELL_MS, then lifts. Momentary taps are ignored.
class PressCycleDriver : public CounterDriver {
 public:
  explicit PressCycleDriver(uint8_t pressPin);
  void begin() override;
  void poll() override;
  uint32_t total() const override { return _total; }
  DriverId id() const override { return DriverId::PRESS; }

 private:
  enum class State : uint8_t { IDLE, PRESSING };

  uint8_t _pressPin;
  uint32_t _total = 0;
  State _state = State::IDLE;
  uint32_t _pressStartMs = 0;

  bool _pressRaw = false;
  bool _pressStable = false;
  uint32_t _pressEdgeMs = 0;

  static constexpr uint32_t DEBOUNCE_MS = 40;
  static constexpr uint32_t MIN_DWELL_MS = 1000;
};
