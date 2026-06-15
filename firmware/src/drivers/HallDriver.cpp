#include "drivers/HallDriver.h"

HallDriver* HallDriver::_instance = nullptr;

HallDriver::HallDriver(uint8_t pin) : _pin(pin) {}

void HallDriver::begin() {
  pinMode(_pin, INPUT_PULLUP);
  _instance = this;
  _count = 0;
  _lastPulseUs = micros();
  attachInterrupt(digitalPinToInterrupt(_pin), isrTrampoline, FALLING);
}

void IRAM_ATTR HallDriver::isrTrampoline() {
  if (_instance) _instance->onPulse();
}

void IRAM_ATTR HallDriver::onPulse() {
  const uint32_t now = micros();
  // micros() wraps every ~71 min; subtraction is still correct modulo 2^32.
  if ((now - _lastPulseUs) >= MIN_PULSE_US) {
    _count++;
    _lastPulseUs = now;
  }
}

void HallDriver::poll() {
  // Counting happens in the ISR; nothing to do on the polled path.
}

uint32_t HallDriver::total() const {
  return _count;
}

bool HallDriver::isRunning() const {
  return (micros() - _lastPulseUs) < STOP_US;
}
