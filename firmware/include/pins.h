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

  // Sensors (‑1 = not fitted). Pin 27 beam-break IR: pull-up, LOW = object blocks beam.
  int8_t horseshoeIr;  // horseshoe IR beam-break (INPUT pin 27, OUTPUT_1 pin 27)
  int8_t currentAdc;   // SCT013 current sensor ADC (INPUT pin 34 only)
  int8_t hall;         // A3144 hall-effect sensor  (INPUT pin 26, OUTPUT_1 pin 26)
  int8_t irCloth;      // unused (legacy OUTPUT_2 garment sensor)
  int8_t irPress;      // OUTPUT_2 sensor pin 27 (active-HIGH, count on rising edge)

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
      // Horseshoe IR (27) = count_pass (pieces through beam, active-low break)
      // Hall A3144 (26)   = count_cycle (motor rotations, open-collector active-low)
      // SCT013 ADC (34)   = live amps only (not counted separately)
      p.horseshoeIr = 27;
      p.hall        = 26;
      p.currentAdc  = 34;
      break;

    case ModuleType::OUTPUT_1:
      // Same sensor layout as INPUT, without the current sensor.
      // Horseshoe IR (27) = count_pass ; Hall A3144 (26) = count_cycle
      p.horseshoeIr = 27;
      p.hall        = 26;
      break;

    case ModuleType::OUTPUT_2:
      // Pin 27 active-HIGH — count +1 on each stable rising edge.
      p.irPress = 27;
      break;

    case ModuleType::ADMIN:
      // NFC + buzzer only; no counting sensors
      break;
  }
  return p;
}

}  // namespace pins
