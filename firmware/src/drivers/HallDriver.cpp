#include "drivers/HallDriver.h"

HallDriver::HallDriver(uint8_t pin) : _pin(pin) {}

void HallDriver::begin() {
  pinMode(_pin, INPUT_PULLUP);
  _lastRaw = digitalRead(_pin);
  _lastStable = _lastRaw;
  _edgeMs = millis();
}

void HallDriver::poll() {
  const bool raw = digitalRead(_pin);
  const uint32_t now = millis();

  if (raw != _lastRaw) {
    _lastRaw = raw;
    _edgeMs = now;
  }

  if (raw != _lastStable && (now - _edgeMs) >= DEBOUNCE_MS) {
    _lastStable = raw;
    if (!raw && (now - _lastCountMs) >= MIN_INTERVAL_MS) {
      _total++;
      _lastCountMs = now;
    }
  }
}
