#include "drivers/PressCycleDriver.h"

PressCycleDriver::PressCycleDriver(uint8_t clothPin, uint8_t pressPin)
    : _clothPin(clothPin), _pressPin(pressPin) {}

void PressCycleDriver::begin() {
  // Active-HIGH sensors: pull down so an idle/disconnected line reads LOW
  // (not-detected) and only a real detection drives it HIGH.
  pinMode(_clothPin, INPUT_PULLDOWN);
  pinMode(_pressPin, INPUT_PULLDOWN);
  _state = State::IDLE;
  _pressRaw = _pressStable = false;
  _pressEdgeMs = millis();
  _hadCloth = false;
}

void PressCycleDriver::poll() {
  const uint32_t now = millis();
  const bool cloth = digitalRead(_clothPin) == HIGH;       // garment present
  const bool pressNow = digitalRead(_pressPin) == HIGH;    // press down

  // Debounce the press signal.
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
        // Press started — remember whether cloth was on the platen.
        _state = State::PRESSING;
        _pressStartMs = now;
        _hadCloth = cloth;
      }
      break;

    case State::PRESSING:
      // Cloth may be detected slightly after the press begins — keep watching.
      if (cloth) _hadCloth = true;
      if (!_pressStable) {
        // Press lifted — count only a real, dwelled press on a garment.
        if (_hadCloth && (now - _pressStartMs) >= MIN_DWELL_MS) {
          _total++;
        }
        _state = State::IDLE;
        _hadCloth = false;
      }
      break;
  }
}
