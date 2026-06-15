#pragma once

#include "drivers/CounterDriver.h"

class HorseshoeIrDriver : public CounterDriver {
 public:
  explicit HorseshoeIrDriver(uint8_t pin);
  void begin() override;
  void poll() override;
  uint32_t total() const override { return _total; }
  DriverId id() const override { return DriverId::HORSESHOE; }

 private:
  enum class State : uint8_t { IDLE, BLOCKED, CONFIRMED };

  uint8_t _pin;
  uint32_t _total = 0;
  State _state = State::IDLE;
  uint32_t _stateMs = 0;
  bool _lastRaw = true;

  static constexpr uint32_t DEBOUNCE_MS = 30;
  static constexpr uint32_t MIN_BLOCK_MS = 150;
};
