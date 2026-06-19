#include "drivers/PressCycleDriver.h"

PressCycleDriver::PressCycleDriver(uint8_t pressPin) : _pressPin(pressPin) {}

void PressCycleDriver::begin() {
  pinMode(_pressPin, INPUT_PULLDOWN);
  _state = State::IDLE;
  _pressRaw = _pressStable = false;
  _pressEdgeMs = millis();
}

void PressCycleDriver::poll() {
  const uint32_t now = millis();
  const bool pressNow = digitalRead(_pressPin) == HIGH;

  if (pressNow != _pressRaw) {
    _pressRaw = pressNow;
    _pressEdgeMs = now;
  }
  if ((now - _pressEdgeMs) >= DEBOUNCE_MS) {
    _pressStable = _pressRaw;
  }

  switch (_state) {
    case State::IDLE:
      if (_pressStable) {
        _state = State::PRESSING;
        _pressStartMs = now;
      }
      break;

    case State::PRESSING:
      if (!_pressStable) {
        if ((now - _pressStartMs) >= MIN_DWELL_MS) {
          _total++;
        }
        _state = State::IDLE;
      }
      break;
  }
}
