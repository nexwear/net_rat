#pragma once

#include <functional>
#include "pins.h"

class NfcSubsystem {
 public:
  using TapCallback = std::function<void(const char* uid)>;

  explicit NfcSubsystem(const pins::PinMap& pins);
  bool begin();
  void pollRead();
  void onTap(TapCallback cb) { _onTap = cb; }
  void setAssignMode(bool enabled) { _assignMode = enabled; }
  bool healthy() const { return _healthy; }

 private:
  bool readUid(char out[24]);
  bool readUid14443(char out[24]);
  bool readUid15693(char out[24]);
  void emitTap(const char* uid);
  uint32_t pollIntervalMs() const;

  pins::PinMap _pins;
  TapCallback _onTap;
  bool _initialized = false;
  bool _healthy = false;
  bool _assignMode = false;
  bool _cardPresent = false;
  uint8_t _failStreak = 0;
  uint8_t _absentStreak = 0;
  uint32_t _lastPollMs = 0;
  uint32_t _lastTapMs = 0;
  uint32_t _lastIdleLogMs = 0;
  uint32_t _quietUntilMs = 0;
  char _lastUid[24] = "";

  static constexpr uint32_t POLL_INTERVAL_MS = 150;
  static constexpr uint32_t ABSENT_CHECK_MS = 300;
  static constexpr uint32_t ASSIGN_ABSENT_CHECK_MS = 200;
  static constexpr uint32_t POST_READ_QUIET_MS = 1000;
  static constexpr uint32_t TAP_GLITCH_MS = 300;
  static constexpr uint8_t ABSENT_DEBOUNCE_POLLS = 2;
  static constexpr uint8_t ASSIGN_ABSENT_DEBOUNCE_POLLS = 3;
};
