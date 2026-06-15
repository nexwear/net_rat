#pragma once

#include "types.h"

namespace pins {

struct PinMap {
  // PN5180 NFC reader (SPI) — same for all modules
  uint8_t pn5180Sck;
  uint8_t pn5180Miso;
  uint8_t pn5180Mosi;
  uint8_t pn5180Nss;
  uint8_t pn5180Busy;
  uint8_t pn5180Rst;

  // Sensors (‑1 = not fitted on this module). All active-HIGH IR sensors read
  // HIGH when an object is detected.
  int8_t horseshoeIr;  // horseshoe IR beam-break (INPUT pin 26, OUTPUT_1 pin 26)
  int8_t currentAdc;   // current sensor ADC   (INPUT pin 34 only)
  int8_t hall;         // hall-effect sensor    (INPUT pin 27, OUTPUT_1 pin 27)
  int8_t irCloth;      // heat-press: garment-present sensor (OUTPUT_2 pin 26)
  int8_t irPress;      // heat-press: press-down sensor      (OUTPUT_2 pin 27)

  // Shared peripherals
  int8_t  buzzer;       // passive buzzer / piezo (pin 15, all modules)
  uint8_t configButton;
  uint8_t statusLed;
};

inline PinMap forModule(ModuleType type) {
  PinMap p{};
  // SPI pins — fixed for all boards
  p.pn5180Sck  = 18;
  p.pn5180Miso = 19;
  p.pn5180Mosi = 23;
  p.pn5180Nss  = 16;
  p.pn5180Busy = 5;
  p.pn5180Rst  = 17;

  // Defaults: nothing fitted
  p.horseshoeIr = -1;
  p.currentAdc  = -1;
  p.hall        = -1;
  p.irCloth     = -1;
  p.irPress     = -1;

  // Shared
  p.buzzer       = 15;
  p.configButton = 0;
  p.statusLed    = 2;

  switch (type) {
    case ModuleType::MOD_INPUT:
      // Horseshoe IR (26) = count_pass (pieces through beam)
      // Hall (27)         = count_cycle (machine-cycle cross-check)
      // Current ADC (34)  = live amps only (not counted separately)
      p.horseshoeIr = 26;
      p.hall        = 27;
      p.currentAdc  = 34;
      break;

    case ModuleType::OUTPUT_1:
      // Horseshoe IR (26) = count_pass
      // Hall (27)         = count_cycle
      p.horseshoeIr = 26;
      p.hall        = 27;
      break;

    case ModuleType::OUTPUT_2:
      // Heat press, two active-HIGH IR sensors:
      //   irCloth (26) = garment present on the platen (object → HIGH)
      //   irPress (27) = press head has come down       (press  → HIGH)
      // PressCycleDriver counts one piece only when a press stroke completes
      // (held ≥ dwell) WITH cloth present — empty presses don't count.
      p.irCloth = 26;
      p.irPress = 27;
      break;

    case ModuleType::ADMIN:
      // NFC + buzzer only; no counting sensors
      break;
  }
  return p;
}

}  // namespace pins
