#pragma once

#include "drivers/CounterDriver.h"

// OUTPUT_2 — pin 27 with pull-up: idle HIGH, LOW while object blocks beam.
// +1 on stable rising edge (LOW → HIGH) after object passes through.
class PressCycleDriver : public CounterDriver {
 public:
  explicit PressCycleDriver(uint8_t pressPin);
  void begin() override;
  void poll() override;
  uint32_t total() const override { return _total; }
  DriverId id() const override { return DriverId::PRESS; }

 private:
  uint8_t _pressPin;
  uint32_t _total = 0;

  bool _raw = true;
  bool _stable = true;
  uint32_t _edgeMs = 0;
  uint32_t _lowStartMs = 0;

  static constexpr uint32_t DEBOUNCE_MS = 40;
  static constexpr uint32_t MIN_LOW_MS = 50;
};
