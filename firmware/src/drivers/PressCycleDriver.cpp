#include "drivers/PressCycleDriver.h"
#include <Arduino.h>

PressCycleDriver::PressCycleDriver(uint8_t pressPin) : _pressPin(pressPin) {}

void PressCycleDriver::begin() {
  // Same beam-break wiring as horseshoe IR on pin 27: pull-up, LOW = object blocks beam.
  pinMode(_pressPin, INPUT_PULLUP);
  _state = State::CLEAR;
  _raw = _stable = false;
  _edgeMs = millis();
}

void PressCycleDriver::poll() {
  const uint32_t now = millis();
  const bool present = digitalRead(_pressPin) == LOW;

  if (present != _raw) {
    _raw = present;
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
          Serial.printf("[PRESS] piece #%lu\n", static_cast<unsigned long>(_total));
        }
        _state = State::CLEAR;
      }
      break;
  }
}
