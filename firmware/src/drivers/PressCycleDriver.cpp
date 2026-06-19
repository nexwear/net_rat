#include "drivers/PressCycleDriver.h"

PressCycleDriver::PressCycleDriver(uint8_t pressPin) : _pressPin(pressPin) {}

void PressCycleDriver::begin() {
  pinMode(_pressPin, INPUT_PULLDOWN);
  _state = State::CLEAR;
  _raw = _stable = false;
  _edgeMs = millis();
}

void PressCycleDriver::poll() {
  const uint32_t now = millis();
  const bool seen = digitalRead(_pressPin) == HIGH;

  if (seen != _raw) {
    _raw = seen;
    _edgeMs = now;
  }
  if ((now - _edgeMs) >= DEBOUNCE_MS) {
    _stable = _raw;
  }

  switch (_state) {
    case State::CLEAR:
      if (_stable) {
        _state = State::PRESENT;
        _presentStartMs = now;
      }
      break;

    case State::PRESENT:
      if (!_stable) {
        if ((now - _presentStartMs) >= MIN_PRESENT_MS) {
          _total++;
        }
        _state = State::CLEAR;
      }
      break;
  }
}
