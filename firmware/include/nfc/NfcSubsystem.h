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
  void setAssignMode(bool enabled) {
    _assignMode = enabled;
    if (enabled) {
      _assignArmed = true;
      _disarmedSinceMs = 0;
      _rfQuietUntilMs = 0;
      _lastUid[0] = '\0';
      _lastRecoverMs = millis();
    }
  }
  /** After admin scan completes — allow the next card without a full removal cycle. */
  void readyForNextAssign();
  /** Call after server processed a scan — waits for card lift before next read. */
  void onAssignFeedback();
  bool healthy() const { return _healthy; }
  /** True when admin reader is armed and waiting for a card tap. */
  bool assignListening() const {
    return _assignMode && _assignArmed && !_cardPresent && _initialized;
  }

 private:
  bool readUid(char out[24]);
  bool readUid14443(char out[24]);
  bool readUid15693(char out[24]);
  bool ensureBusReady();
  void forceHardwareReset();
  void recoverReader(const char* reason);
  bool emitTap(const char* uid);
  void tickAssignWatchdog(uint32_t now);
  uint32_t pollIntervalMs() const;

  pins::PinMap _pins;
  TapCallback _onTap;
  bool _initialized = false;
  bool _healthy = false;
  bool _assignMode = false;
  bool _assignArmed = true;
  bool _cardPresent = false;
  uint8_t _failStreak = 0;
  uint8_t _absentStreak = 0;
  uint32_t _lastPollMs = 0;
  uint32_t _lastTapMs = 0;
  uint32_t _lastIdleLogMs = 0;
  uint32_t _quietUntilMs = 0;
  uint32_t _rfQuietUntilMs = 0;
  uint32_t _disarmedSinceMs = 0;
  uint32_t _lastRecoverMs = 0;
  char _lastUid[24] = "";

  static constexpr uint32_t POLL_INTERVAL_MS = 120;
  static constexpr uint32_t ABSENT_CHECK_MS = 120;
  static constexpr uint32_t POST_READ_QUIET_MS = 180;
  static constexpr uint32_t TAP_GLITCH_MS = 300;
  static constexpr uint32_t ASSIGN_SAME_UID_MS = 1500;
  static constexpr uint32_t ASSIGN_RF_QUIET_MS = 300;
  static constexpr uint32_t ASSIGN_STUCK_MS = 15000;
  static constexpr uint32_t PERIODIC_RECOVER_MS = 120000;
  static constexpr uint32_t BUSY_STUCK_MS = 80;
  static constexpr uint8_t ABSENT_DEBOUNCE_POLLS = 3;  // ~3 misses before "lifted"
  static constexpr uint8_t ASSIGN_ABSENT_DEBOUNCE_POLLS = 2;
};
