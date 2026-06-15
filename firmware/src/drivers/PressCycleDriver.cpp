#include "drivers/PressCycleDriver.h"

PressCycleDriver::PressCycleDriver(uint8_t pinDown, uint8_t pinUp)
    : _pinDown(pinDown), _pinUp(pinUp) {}

void PressCycleDriver::begin() {
  pinMode(_pinDown, INPUT_PULLUP);
  pinMode(_pinUp, INPUT_PULLUP);
  _state = State::OPEN;
  _stateMs = millis();
}

void PressCycleDriver::poll() {
  const bool down = !digitalRead(_pinDown);
  const bool up = !digitalRead(_pinUp);
  const uint32_t now = millis();

  switch (_state) {
    case State::OPEN:
      if (down) {
        _state = State::CLOSING;
        _stateMs = now;
      }
      break;
    case State::CLOSING:
      if (down && (now - _stateMs) >= DEBOUNCE_MS) {
        _state = State::DWELL;
        _stateMs = now;
      } else if (!down) {
        _state = State::OPEN;
      }
      break;
    case State::DWELL:
      if (!down) {
        _state = State::OPEN;
      } else if ((now - _stateMs) >= MIN_DWELL_MS) {
        _state = State::OPENING;
        _stateMs = now;
      }
      break;
    case State::OPENING:
      if (up && (now - _stateMs) >= DEBOUNCE_MS) {
        _total++;
        _state = State::OPEN;
        _stateMs = now;
      } else if (!up && !down) {
        _state = State::OPEN;
      }
      break;
  }
}
