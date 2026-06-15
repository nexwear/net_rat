#pragma once

#include <Arduino.h>

// Patterns emitted by the buzzer
enum class BuzzPattern : uint8_t {
  TAP_IN,        // two short beeps — "session opened"
  TAP_OUT,       // one medium descending beep — "session closed"
  QUANTITY_DONE, // three rising beeps — "bundle complete"
  ERROR,         // two low quick beeps — "unrecognised / no bundle"
  ADMIN_NEW,     // double beep — card registered with new number
  ADMIN_EXISTS,  // low-long + high-short — card already in registry
};

// Non-blocking buzzer driver using ESP32 LEDC.
// Call poll() every loop iteration (< 20 ms) to advance playback.
class BuzzerDriver {
 public:
  explicit BuzzerDriver(int8_t pin);
  void begin();
  void play(BuzzPattern p);
  void poll();
  bool playing() const { return _playing; }

 private:
  struct Step {
    uint16_t freqHz; // 0 = silence
    uint16_t ms;
  };

  static constexpr uint8_t  LEDC_CHAN     = 1;
  static constexpr uint8_t  LEDC_RES     = 10;
  static constexpr uint8_t  MAX_STEPS    = 7;

  int8_t   _pin;
  Step     _steps[MAX_STEPS]{};
  uint8_t  _stepCount  = 0;
  uint8_t  _stepIdx    = 0;
  uint32_t _stepStart  = 0;
  bool     _playing    = false;

  void startStep(uint8_t idx);
  void stop();
};
