#pragma once

#include "drivers/CounterDriver.h"
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

// True-RMS current measurement for an SCT-013 current transformer — an ESP32
// port of the OpenEnergyMonitor EmonLib method (the de-facto standard for CT
// energy sensing):
//   1. read the ESP32 factory-calibrated ADC (analogReadMilliVolts),
//   2. remove the DC bias with a digital high-pass filter,
//   3. accumulate the sum of squares over a whole number of mains cycles,
//   4. Irms = CT_calibration * sqrt(mean(squares)).
// Unlike peak-to-peak detection this is correct for the distorted, non-sinusoidal
// current a sewing motor draws. Sampling runs in its own low-priority task so it
// never stalls piece counting or the NFC poll.
class CurrentDriver : public CounterDriver {
 public:
  explicit CurrentDriver(uint8_t adcPin);
  void begin() override;
  void poll() override {}  // sampling lives in the dedicated task
  uint32_t total() const override { return _runCycles.load(); }
  DriverId id() const override { return DriverId::CURRENT; }
  float aux() const override { return _amps.load(); }  // latest Irms in amps

 private:
  void sampleLoop();
  static void taskTrampoline(void* arg);

  uint8_t _pin;
  std::atomic<float> _amps{0.0f};
  std::atomic<uint32_t> _runCycles{0};
  TaskHandle_t _task = nullptr;
  bool _running = false;

  // Each measurement integrates over WINDOW_MS of mains: 200 ms = 10 cycles @
  // 50 Hz (or 12 @ 60 Hz), which makes the RMS independent of phase/aliasing.
  static constexpr uint32_t WINDOW_MS = 200;
  static constexpr uint32_t REST_MS = 250;       // idle gap between measurements
  static constexpr float NOISE_FLOOR_A = 0.10f;  // below this we report 0 A
  // Machine on/off run counting (diagnostics via total(); not piece counting).
  static constexpr float RUN_ON_A = 0.80f;
  static constexpr float RUN_OFF_A = 0.55f;
};

// Calibration: amps (RMS) per 1 volt (RMS) seen at the ADC after bias removal.
// Override per board with -DCURRENT_CAL=<value> in platformio.ini.
//   SCT-013-030 (30 A : 1 V, internal burden) -> 30.0
//   SCT-013-050 (50 A : 1 V)                   -> 50.0
//   SCT-013-100 (100 A : 1 V)                  -> 100.0
//   SCT-013-000 (2000:1 turns, ext. burden R)  -> 2000.0 / R_ohms
#ifndef CURRENT_CAL
#define CURRENT_CAL 30.0f
#endif
