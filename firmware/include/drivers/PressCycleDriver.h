#pragma once

#include "drivers/CounterDriver.h"

// OUTPUT_2 — pin 27 active-HIGH sensor: pull-down, idle LOW, +1 on stable rising edge.
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

  bool _raw = false;
  bool _stable = false;
  uint32_t _edgeMs = 0;

  static constexpr uint32_t DEBOUNCE_MS = 40;
};
