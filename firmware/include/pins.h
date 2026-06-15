#pragma once

#include "types.h"

namespace pins {

struct PinMap {
  uint8_t pn5180Sck;
  uint8_t pn5180Miso;
  uint8_t pn5180Mosi;
  uint8_t pn5180Nss;
  uint8_t pn5180Busy;
  uint8_t pn5180Rst;
  int8_t  horseshoeIr;   // -1 if unused
  int8_t  currentAdc;    // -1 if unused
  int8_t  hall;          // -1 if unused
  int8_t  pressDown;     // -1 if unused
  int8_t  pressUp;       // -1 if unused
  uint8_t configButton;
  uint8_t statusLed;
};

inline PinMap forModule(ModuleType type) {
  PinMap p{};
  p.pn5180Sck = 18;
  p.pn5180Miso = 19;
  p.pn5180Mosi = 23;
  p.pn5180Nss = 16;
  p.pn5180Busy = 5;
  p.pn5180Rst = 17;
  p.configButton = 0;
  p.statusLed = 2;
  p.horseshoeIr = -1;
  p.currentAdc = -1;
  p.hall = -1;
  p.pressDown = -1;
  p.pressUp = -1;

  switch (type) {
    case ModuleType::MOD_INPUT:
      p.horseshoeIr = 27;
      p.currentAdc = 34;
      break;
    case ModuleType::OUTPUT_1:
      p.horseshoeIr = 27;
      p.hall = 32;
      break;
    case ModuleType::OUTPUT_2:
      p.pressDown = 25;
      p.pressUp = 26;
      break;
    case ModuleType::ADMIN:
      break;
  }
  return p;
}

}  // namespace pins
