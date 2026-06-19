#include "drivers/PressCycleDriver.h"
#include <Arduino.h>

PressCycleDriver::PressCycleDriver(uint8_t pressPin) : _pressPin(pressPin) {}

void PressCycleDriver::begin() {
  pinMode(_pressPin, INPUT_PULLDOWN);
  _raw = _stable = false;
  _edgeMs = millis();
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

  if (!_stable && nextStable) {
    _total++;
    Serial.printf("[PRESS] piece #%lu (pin high)\n", static_cast<unsigned long>(_total));
  }
  _stable = nextStable;
}
