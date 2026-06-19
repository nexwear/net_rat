#include "drivers/PressCycleDriver.h"
#include <Arduino.h>

PressCycleDriver::PressCycleDriver(uint8_t pressPin) : _pressPin(pressPin) {}

void PressCycleDriver::begin() {
  // Beam-break / active sensor on pin 27: pull-up, idle HIGH, LOW while object blocks.
  pinMode(_pressPin, INPUT_PULLUP);
  const bool high = digitalRead(_pressPin) == HIGH;
  _raw = _stable = high;
  _edgeMs = millis();
  _lowStartMs = 0;
}

void PressCycleDriver::poll() {
  const uint32_t now = millis();
  const bool high = digitalRead(_pressPin) == HIGH;

  if (high != _raw) {
    _raw = high;
    _edgeMs = now;
  }

  bool nextStable = _stable;
  if ((now - _edgeMs) >= DEBOUNCE_MS) {
    nextStable = _raw;
  }

  if (_stable && !nextStable) {
    _lowStartMs = now;
    Serial.println("[PRESS] pin LOW (object blocking)");
  }

  if (!_stable && nextStable) {
    const uint32_t lowMs = _lowStartMs > 0 ? now - _lowStartMs : 0;
    if (lowMs >= MIN_LOW_MS) {
      _total++;
      Serial.printf("[PRESS] piece #%lu (pin HIGH after %lums LOW)\n",
                    static_cast<unsigned long>(_total), static_cast<unsigned long>(lowMs));
    } else if (_lowStartMs > 0) {
      Serial.printf("[PRESS] ignored short LOW (%lums)\n", static_cast<unsigned long>(lowMs));
    }
    _lowStartMs = 0;
  }

  _stable = nextStable;
}
