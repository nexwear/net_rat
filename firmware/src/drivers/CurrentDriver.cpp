#include "drivers/CurrentDriver.h"
#include "core/RuntimeFlags.h"
#include <Arduino.h>
#include <math.h>

CurrentDriver::CurrentDriver(uint8_t adcPin) : _pin(adcPin) {}

void CurrentDriver::begin() {
  analogSetPinAttenuation(_pin, ADC_11db);  // ~0–3.1 V usable input range
  analogReadResolution(12);
  // Dedicated sampler on core 0, low priority — decoupled from the counting loop.
  if (xTaskCreatePinnedToCore(taskTrampoline, "CurSense", 4096, this, 1, &_task, 0) != pdPASS) {
    _task = nullptr;
    Serial.println("[CUR] sampler task create failed — current reads disabled");
  }
  gCurrentTaskHandle = _task;
}

void CurrentDriver::taskTrampoline(void* arg) {
  static_cast<CurrentDriver*>(arg)->sampleLoop();
}

void CurrentDriver::sampleLoop() {
  // DC-bias tracker (EmonLib), seeded at mid-rail (~1.65 V). Persists across
  // measurements so it stays converged and only follows slow drift, never the
  // 50/60 Hz signal.
  float offsetMv = 1650.0f;

  for (;;) {
    double sumSq = 0.0;
    uint32_t n = 0;
    const uint32_t start = millis();
    while ((millis() - start) < WINDOW_MS) {
      const float mv = static_cast<float>(analogReadMilliVolts(_pin));
      offsetMv += (mv - offsetMv) / 1024.0f;  // high-pass: track the DC midpoint
      const float filtered = mv - offsetMv;
      sumSq += static_cast<double>(filtered) * filtered;
      n++;
    }

    float amps = 0.0f;
    if (n > 0) {
      const float vrmsMv = sqrtf(static_cast<float>(sumSq / n));
      amps = (vrmsMv / 1000.0f) * CURRENT_CAL;
      if (amps < NOISE_FLOOR_A) {
        amps = 0.0f;
      }
    }
    _amps.store(amps);

    // Machine on→off edges, hysteresis-debounced (diagnostics only).
    if (!_running && amps >= RUN_ON_A) {
      _running = true;
    } else if (_running && amps < RUN_OFF_A) {
      _running = false;
      _runCycles.fetch_add(1);
    }

    vTaskDelay(pdMS_TO_TICKS(REST_MS));
  }
}
