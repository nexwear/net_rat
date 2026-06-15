#pragma once

#include <Arduino.h>
#include <cstdint>

enum class ModuleType : uint8_t { MOD_INPUT, OUTPUT_1, OUTPUT_2, ADMIN };
enum class DriverId : uint8_t { HORSESHOE, CURRENT, HALL, PRESS };
enum class NodeState : uint8_t { PROVISIONING, ACTIVE, REPROVISIONING };
enum class CloseReason : uint8_t { NEXT_TAP, TAP_OUT, QUANTITY, TIMEOUT, SHIFT_END };
enum class TelemetryType : uint8_t {
  HEARTBEAT,
  SCAN,
  SESSION_UPDATE,
  SESSION_CLOSE,
  UNASSIGNED
};
enum class ScanKind : uint8_t { TAP_IN, TAP_OUT, AUTO_CLOSE, ASSIGN_SCAN };
enum class CmdType : uint8_t { REPROVISION, CARD_DECLARED };

struct TelemetryEvent {
  TelemetryType type;
  char eventId[37];
  uint32_t seq;
  char cardUid[24];
  char sessionId[37];
  uint32_t countPass;
  uint32_t countCycle;
  float currentAmps;
  uint8_t scanKind;
  uint8_t closeReason;
  uint64_t tsEpochMs;
  bool tsValid;
};

struct Command {
  CmdType type;
  uint32_t declaredPieces = 0;
  uint32_t ppp = 0;  // pulses-per-piece for this bundle's style+size (0 = leave unchanged)
};

inline const char* moduleTypeToString(ModuleType t) {
  switch (t) {
    case ModuleType::MOD_INPUT: return "INPUT";
    case ModuleType::OUTPUT_1: return "OUTPUT_1";
    case ModuleType::OUTPUT_2: return "OUTPUT_2";
    case ModuleType::ADMIN: return "ADMIN";
  }
  return "INPUT";
}

inline ModuleType moduleTypeFromString(const String& s) {
  if (s == "OUTPUT_1") return ModuleType::OUTPUT_1;
  if (s == "OUTPUT_2") return ModuleType::OUTPUT_2;
  if (s == "ADMIN") return ModuleType::ADMIN;
  return ModuleType::MOD_INPUT;
}

inline const char* scanKindToString(ScanKind k) {
  switch (k) {
    case ScanKind::TAP_IN: return "TAP_IN";
    case ScanKind::TAP_OUT: return "TAP_OUT";
    case ScanKind::AUTO_CLOSE: return "AUTO_CLOSE";
    case ScanKind::ASSIGN_SCAN: return "ASSIGN_SCAN";
  }
  return "TAP_IN";
}

inline const char* closeReasonToString(CloseReason r) {
  switch (r) {
    case CloseReason::NEXT_TAP: return "NEXT_TAP";
    case CloseReason::TAP_OUT: return "TAP_OUT";
    case CloseReason::QUANTITY: return "QUANTITY";
    case CloseReason::TIMEOUT: return "TIMEOUT";
    case CloseReason::SHIFT_END: return "SHIFT_END";
  }
  return "TIMEOUT";
}
