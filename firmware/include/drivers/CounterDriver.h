#pragma once

#include "types.h"

class CounterDriver {
 public:
  virtual ~CounterDriver() = default;
  virtual void begin() = 0;
  virtual void poll() = 0;
  virtual uint32_t total() const = 0;
  virtual DriverId id() const = 0;
  virtual float aux() const { return 0.0f; }
};
