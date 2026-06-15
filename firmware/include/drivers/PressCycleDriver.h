#pragma once

#include "drivers/CounterDriver.h"

class PressCycleDriver : public CounterDriver {
 public:
  PressCycleDriver(uint8_t pinDown, uint8_t pinUp);
  void begin() override;
  void poll() override;
  uint32_t total() const override { return _total; }
  DriverId id() const override { return DriverId::PRESS; }

 private:
  enum class State : uint8_t { OPEN, CLOSING, DWELL, OPENING };

  uint8_t _pinDown;
  uint8_t _pinUp;
  uint32_t _total = 0;
  State _state = State::OPEN;
  uint32_t _stateMs = 0;

  static constexpr uint32_t DEBOUNCE_MS = 30;
  static constexpr uint32_t MIN_DWELL_MS = 1000;
};
