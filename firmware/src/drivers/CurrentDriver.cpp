#include "drivers/CurrentDriver.h"

CurrentDriver::CurrentDriver(uint8_t adcPin) : _pin(adcPin) {}

void CurrentDriver::begin() {
  pinMode(_pin, INPUT);
  analogSetAttenuation(ADC_11db);
  analogReadResolution(12);
  _lastSampleMs = millis();
}

void CurrentDriver::finishBurstSample(uint32_t now) {
  // SEN0211-style: Vpp from min/max ADC, then Vrms → amps (matches field sketch)
  const float vppMv =
      static_cast<float>(_sampleMax - _sampleMin) * (SEN0211_VREF_MV / SEN0211_ADC_MAX);
  const float vrms = (vppMv / 2.0f) * 0.707f;
  float amps = vrms / SEN0211_SENSITIVITY;
  if (amps < NOISE_FLOOR_A) {
    amps = 0.0f;
  }

  _emaAmps = (_emaAmps * 0.4f) + (amps * 0.6f);
  _liveAmps = _emaAmps;
  _sampling = false;
  _lastSampleMs = now;

  switch (_cycle) {
    case CycleState::IDLE:
      if (_emaAmps >= RUN_THRESHOLD_A) {
        _cycle = CycleState::RUNNING;
        _cycleStartMs = now;
      }
      break;
    case CycleState::RUNNING:
      if (_emaAmps < (RUN_THRESHOLD_A - HYST_A)) {
        if ((now - _cycleStartMs) >= CUR_MIN_RUN_MS) {
          _total++;
        }
        _cycle = CycleState::IDLE;
      }
      break;
  }
}

void CurrentDriver::poll() {
  const uint32_t now = millis();

  if (_sampling) {
    const int raw = analogRead(_pin);
    if (raw < static_cast<int>(_sampleMin)) _sampleMin = raw;
    if (raw > static_cast<int>(_sampleMax)) _sampleMax = raw;
    if ((now - _sampleStartMs) >= CUR_SAMPLE_WINDOW_MS) {
      finishBurstSample(now);
    }
    return;
  }

  if ((now - _lastSampleMs) >= CUR_SAMPLE_INTERVAL_MS) {
    _sampling = true;
    _sampleStartMs = now;
    _sampleMin = 4095;
    _sampleMax = 0;
  }
}
