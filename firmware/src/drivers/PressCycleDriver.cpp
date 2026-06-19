#include "drivers/PressCycleDriver.h"
#include <Arduino.h>

PressCycleDriver::PressCycleDriver(uint8_t pressPin) : _pressPin(pressPin) {}

void PressCycleDriver::begin() {
  // Active-HIGH sensor on pin 27: pull-down, idle LOW, HIGH while pressed/blocked.
  pinMode(_pressPin, INPUT_PULLDOWN);
  const bool high = digitalRead(_pressPin) == HIGH;
  _raw = _stable = high;
  _edgeMs = millis();
  Serial.printf("[PRESS] pin %u init idle=%s (count on LOW→HIGH)\n", _pressPin,
                high ? "HIGH" : "LOW");
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
    Serial.printf("[PRESS] piece #%lu (pin HIGH)\n", static_cast<unsigned long>(_total));
  }

  _stable = nextStable;
}
