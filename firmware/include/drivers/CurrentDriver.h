#pragma once

#include "drivers/CounterDriver.h"

class CurrentDriver : public CounterDriver {
 public:
  explicit CurrentDriver(uint8_t adcPin);
  void begin() override;
  void poll() override;
  uint32_t total() const override { return _total; }
  DriverId id() const override { return DriverId::CURRENT; }
  float aux() const override { return _liveAmps; }

 private:
  enum class CycleState : uint8_t { IDLE, RUNNING };

  uint8_t _pin;
  uint32_t _total = 0;
  float _liveAmps = 0.0f;
  float _emaAmps = 0.0f;
  CycleState _cycle = CycleState::IDLE;
  uint32_t _cycleStartMs = 0;
  uint32_t _lastSampleMs = 0;
  bool _sampling = false;
  uint32_t _sampleStartMs = 0;
  uint16_t _sampleMin = 4095;
  uint16_t _sampleMax = 0;

  void finishBurstSample(uint32_t now);

  static constexpr uint32_t CUR_SAMPLE_WINDOW_MS = 40;
  static constexpr uint32_t CUR_SAMPLE_INTERVAL_MS = 200;
  static constexpr float NOISE_FLOOR_A = 0.10f;
  static constexpr float RUN_THRESHOLD_A = 0.80f;
  static constexpr float HYST_A = 0.15f;
  static constexpr uint32_t CUR_MIN_RUN_MS = 200;
  // DFRobot SEN0211 50A current sensor (field-calibrated values from cloth-counter sketch)
  static constexpr float SEN0211_VREF_MV = 3300.0f;
  static constexpr float SEN0211_ADC_MAX = 4095.0f;
  static constexpr float SEN0211_SENSITIVITY = 50.0f;
};
