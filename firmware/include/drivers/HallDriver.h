#pragma once

#include "drivers/CounterDriver.h"

// Hall-effect sensor mounted on the sewing-machine rotary shaft.
// It pulses once per rotation, so at speed it fires far faster than the
// 10 ms sensing poll can catch. We therefore count on a GPIO interrupt and
// expose the raw rotation total — this is the "work quantum" the server
// divides by pulses-per-piece (PPP) to estimate pieces.
class HallDriver : public CounterDriver {
 public:
  explicit HallDriver(uint8_t pin);
  void begin() override;
  void poll() override;
  uint32_t total() const override;        // total rotations since boot
  DriverId id() const override { return DriverId::HALL; }

  // True if a pulse arrived recently (machine is spinning).
  bool isRunning() const;

 private:
  static void IRAM_ATTR isrTrampoline();
  void IRAM_ATTR onPulse();

  static HallDriver* _instance;  // one hall sensor per node

  uint8_t _pin;
  volatile uint32_t _count = 0;
  volatile uint32_t _lastPulseUs = 0;

  // Ignore pulses closer than this — debounces contact bounce while still
  // allowing up to 1 kHz (≈ 60 000 RPM, well above any real machine).
  static constexpr uint32_t MIN_PULSE_US = 1000;
  // No pulse for this long ⇒ machine considered stopped.
  static constexpr uint32_t STOP_US = 300000;  // 300 ms
};
