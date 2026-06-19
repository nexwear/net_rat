#pragma once

#include "drivers/CounterDriver.h"

// OUTPUT_2 — single active-HIGH IR on pin 27 (object / press present → HIGH).
// One piece when the object comes (stable HIGH) then goes (stable LOW).
class PressCycleDriver : public CounterDriver {
 public:
  explicit PressCycleDriver(uint8_t pressPin);
  void begin() override;
  void poll() override;
  uint32_t total() const override { return _total; }
  DriverId id() const override { return DriverId::PRESS; }

 private:
  enum class State : uint8_t { CLEAR, PRESENT };

  uint8_t _pressPin;
  uint32_t _total = 0;
  State _state = State::CLEAR;
  uint32_t _presentStartMs = 0;

  bool _raw = false;
  bool _stable = false;
  uint32_t _edgeMs = 0;

  static constexpr uint32_t DEBOUNCE_MS = 40;
  // Reject sub-100 ms blips; any real come-and-go cycle counts as one.
  static constexpr uint32_t MIN_PRESENT_MS = 100;
};
