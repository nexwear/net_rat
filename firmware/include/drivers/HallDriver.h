#pragma once

#include "drivers/CounterDriver.h"

class HallDriver : public CounterDriver {
 public:
  explicit HallDriver(uint8_t pin);
  void begin() override;
  void poll() override;
  uint32_t total() const override { return _total; }
  DriverId id() const override { return DriverId::HALL; }

 private:
  uint8_t _pin;
  uint32_t _total = 0;
  bool _lastStable = true;
  bool _lastRaw = true;
  uint32_t _edgeMs = 0;
  uint32_t _lastCountMs = 0;

  static constexpr uint32_t DEBOUNCE_MS = 30;
  static constexpr uint32_t MIN_INTERVAL_MS = 150;
};
