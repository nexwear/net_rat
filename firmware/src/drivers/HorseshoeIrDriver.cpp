#include "drivers/HorseshoeIrDriver.h"

HorseshoeIrDriver::HorseshoeIrDriver(uint8_t pin) : _pin(pin) {}

void HorseshoeIrDriver::begin() {
  pinMode(_pin, INPUT_PULLUP);
  _lastRaw = digitalRead(_pin);
  _state = State::IDLE;
  _stateMs = millis();
}

void HorseshoeIrDriver::poll() {
  const bool raw = digitalRead(_pin);
  const uint32_t now = millis();

  if (raw != _lastRaw) {
    _lastRaw = raw;
    _stateMs = now;
  }

  switch (_state) {
    case State::IDLE:
      if (!raw && (now - _stateMs) >= DEBOUNCE_MS) {
        _state = State::BLOCKED;
        _stateMs = now;
      }
      break;
    case State::BLOCKED:
      if (!raw && (now - _stateMs) >= MIN_BLOCK_MS) {
        _state = State::CONFIRMED;
      } else if (raw && (now - _stateMs) >= DEBOUNCE_MS) {
        _state = State::IDLE;
      }
      break;
    case State::CONFIRMED:
      if (raw && (now - _stateMs) >= DEBOUNCE_MS) {
        _total++;
        _state = State::IDLE;
        _stateMs = now;
      }
      break;
  }
}
