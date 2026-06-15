#include "drivers/BuzzerDriver.h"

BuzzerDriver::BuzzerDriver(int8_t pin) : _pin(pin) {}

void BuzzerDriver::begin() {
  if (_pin < 0) return;
  ledcSetup(LEDC_CHAN, 2700, LEDC_RES);
  ledcAttachPin(static_cast<uint8_t>(_pin), LEDC_CHAN);
  ledcWriteTone(LEDC_CHAN, 0);
}

void BuzzerDriver::play(BuzzPattern p) {
  if (_pin < 0) return;

  switch (p) {
    case BuzzPattern::TAP_IN:
      // Short double beep — "acknowledged"
      _steps[0] = {2700, 120};
      _steps[1] = {0,    70};
      _steps[2] = {2700, 120};
      _stepCount = 3;
      break;

    case BuzzPattern::TAP_OUT:
      // Single descending beep — "closing"
      _steps[0] = {2200, 100};
      _steps[1] = {1800, 100};
      _steps[2] = {1400, 150};
      _stepCount = 3;
      break;

    case BuzzPattern::QUANTITY_DONE:
      // Triple rising beep — "bundle complete"
      _steps[0] = {2000, 160};
      _steps[1] = {0,    80};
      _steps[2] = {2500, 160};
      _steps[3] = {0,    80};
      _steps[4] = {3200, 280};
      _stepCount = 5;
      break;

    case BuzzPattern::ERROR:
      // Two low quick beeps — "unrecognised / no bundle"
      _steps[0] = {900, 100};
      _steps[1] = {0,   80};
      _steps[2] = {900, 100};
      _stepCount = 3;
      break;

    case BuzzPattern::ADMIN_NEW:
      _steps[0] = {2700, 120};
      _steps[1] = {0,    70};
      _steps[2] = {2700, 120};
      _stepCount = 3;
      break;

    case BuzzPattern::ADMIN_EXISTS:
      // Distinct from TAP_IN — already registered
      _steps[0] = {1400, 220};
      _steps[1] = {0,    80};
      _steps[2] = {2400, 100};
      _stepCount = 3;
      break;
  }

  _stepIdx = 0;
  _playing = true;
  startStep(0);
}

void BuzzerDriver::startStep(uint8_t idx) {
  ledcWriteTone(LEDC_CHAN, _steps[idx].freqHz);
  _stepStart = millis();
}

void BuzzerDriver::stop() {
  ledcWriteTone(LEDC_CHAN, 0);
  _playing = false;
}

void BuzzerDriver::poll() {
  if (!_playing || _pin < 0) return;
  if ((millis() - _stepStart) < _steps[_stepIdx].ms) return;

  _stepIdx++;
  if (_stepIdx >= _stepCount) {
    stop();
  } else {
    startStep(_stepIdx);
  }
}
