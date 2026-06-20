#include "nfc/NfcSubsystem.h"
#include <PN5180.h>
#include <PN5180ISO14443.h>
#include <PN5180ISO15693.h>
#include <SPI.h>
#include <cstring>

namespace {
PN5180ISO14443* gIso14443 = nullptr;
PN5180ISO15693* gIso15693 = nullptr;

void formatHexUid(const uint8_t* uid, uint8_t len, char out[24]) {
  size_t pos = 0;
  for (uint8_t i = 0; i < len && pos + 2 < 24; i++) {
    pos += snprintf(out + pos, 24 - pos, "%02X", uid[i]);
  }
  out[pos] = '\0';
}

bool uidAllZero(const uint8_t* uid, size_t len) {
  for (size_t i = 0; i < len; i++) {
    if (uid[i] != 0) {
      return false;
    }
  }
  return true;
}

bool pn5180Responding(PN5180ISO14443* nfc) {
  uint8_t productVersion[2] = {};
  // readEEprom now returns false on a BUSY timeout (vendored PN5180 patch); a
  // failed read must not be reported as a healthy reader.
  if (!nfc->readEEprom(PRODUCT_VERSION, productVersion, sizeof(productVersion))) {
    return false;
  }
  return productVersion[1] != 0xFF;
}

void tryRecoverReader(PN5180ISO14443* nfc, PN5180ISO15693* iso15693, uint8_t& failStreak,
                      bool& healthy) {
  if (++failStreak < 3) {
    return;
  }
  failStreak = 0;
  healthy = false;
  Serial.println("[NFC] RF setup failed — re-initializing PN5180");
  nfc->begin();
  nfc->reset();
  if (iso15693) {
    iso15693->begin();
  }
  healthy = pn5180Responding(nfc);
  if (!healthy) {
    Serial.println("[NFC] PN5180 still not responding after re-init");
  }
}
}  // namespace

NfcSubsystem::NfcSubsystem(const pins::PinMap& pins) : _pins(pins) {}

bool NfcSubsystem::begin() {
  SPI.begin(_pins.pn5180Sck, _pins.pn5180Miso, _pins.pn5180Mosi, _pins.pn5180Nss);
  gIso14443 = new PN5180ISO14443(_pins.pn5180Nss, _pins.pn5180Busy, _pins.pn5180Rst);
  gIso15693 = new PN5180ISO15693(_pins.pn5180Nss, _pins.pn5180Busy, _pins.pn5180Rst);

  gIso14443->begin();
  gIso14443->reset();
  delay(10);

  uint8_t productVersion[2] = {};
  gIso14443->readEEprom(PRODUCT_VERSION, productVersion, sizeof(productVersion));
  if (!pn5180Responding(gIso14443)) {
    _initialized = false;
    _healthy = false;
    Serial.println("[NFC] PN5180 not responding — check wiring (NSS 16, BUSY 5, RST 17)");
    return false;
  }

  gIso15693->begin();
  _initialized = true;
  _healthy = true;
  _lastPollMs = millis();
  _cardPresent = false;
  _absentStreak = 0;
  _quietUntilMs = 0;
  _lastRecoverMs = millis();
  Serial.printf("[NFC] PN5180 ready (product 0x%02X%02X)\n", productVersion[0], productVersion[1]);
  return true;
}

bool NfcSubsystem::ensureBusReady() {
  const uint32_t start = millis();
  while (digitalRead(_pins.pn5180Busy) == HIGH) {
    if ((millis() - start) > BUSY_STUCK_MS) {
      Serial.println("[NFC] BUSY stuck — hardware reset");
      forceHardwareReset();
      return false;
    }
    delay(1);
  }
  return true;
}

void NfcSubsystem::forceHardwareReset() {
  if (_pins.pn5180Rst < 0 || !gIso14443) {
    return;
  }
  digitalWrite(_pins.pn5180Rst, LOW);
  delay(15);
  digitalWrite(_pins.pn5180Rst, HIGH);
  delay(15);
  gIso14443->reset();
  if (gIso15693) {
    gIso15693->begin();
  }
  _failStreak = 0;
  _healthy = pn5180Responding(gIso14443);
}

void NfcSubsystem::recoverReader(const char* reason) {
  Serial.printf("[NFC] recover: %s\n", reason ? reason : "unknown");
  _lastRecoverMs = millis();
  _failStreak = 0;
  forceHardwareReset();
  if (!gIso14443 || !gIso15693) {
    return;
  }
  gIso14443->begin();
  gIso15693->begin();
  _healthy = pn5180Responding(gIso14443);
  _rfQuietUntilMs = millis() + 200;
}

bool NfcSubsystem::readUid14443(char out[24]) {
  if (!ensureBusReady()) {
    return false;
  }
  gIso14443->reset();
  if (!gIso14443->setupRF()) {
    tryRecoverReader(gIso14443, gIso15693, _failStreak, _healthy);
    return false;
  }
  uint8_t uid[10] = {};
  const uint8_t uidLen = gIso14443->readCardSerial(uid);
  if (uidLen > 0 && !uidAllZero(uid, uidLen)) {
    formatHexUid(uid, uidLen, out);
    _healthy = true;
    _failStreak = 0;
    return true;
  }
  return false;
}

bool NfcSubsystem::readUid15693(char out[24]) {
  if (!ensureBusReady()) {
    return false;
  }
  gIso15693->reset();
  if (!gIso15693->setupRF()) {
    tryRecoverReader(gIso14443, gIso15693, _failStreak, _healthy);
    return false;
  }
  uint8_t uid15693[8] = {};
  if (gIso15693->getInventory(uid15693) == ISO15693_EC_OK && !uidAllZero(uid15693, sizeof(uid15693))) {
    formatHexUid(uid15693, sizeof(uid15693), out);
    _healthy = true;
    _failStreak = 0;
    return true;
  }
  return false;
}

bool NfcSubsystem::readUid(char out[24]) {
  if (!gIso14443 || !gIso15693 || !_initialized) {
    return false;
  }

  out[0] = '\0';
  // Admin desk tags are often ISO15693 — try that first in assign mode.
  if (_assignMode) {
    if (readUid15693(out)) {
      return true;
    }
    return readUid14443(out);
  }
  if (readUid14443(out)) {
    return true;
  }
  return readUid15693(out);
}

void NfcSubsystem::readyForNextAssign() {
  _absentStreak = 0;
  _assignArmed = true;
  _disarmedSinceMs = 0;
  _rfQuietUntilMs = 0;
  _cardPresent = false;
  _lastUid[0] = '\0';
  if (gIso14443) {
    gIso14443->reset();
  }
  Serial.println("[NFC] ready for next card");
}

void NfcSubsystem::onAssignFeedback() {
  _rfQuietUntilMs = millis() + ASSIGN_RF_QUIET_MS;
  _disarmedSinceMs = 0;
  if (_cardPresent) {
    Serial.println("[NFC] scan done — lift card for next");
    return;
  }
  _assignArmed = true;
  _lastUid[0] = '\0';
}

void NfcSubsystem::tickAssignWatchdog(uint32_t now) {
  if (!_assignMode || !_initialized) {
    return;
  }

  if (!_assignArmed && _disarmedSinceMs != 0 && (now - _disarmedSinceMs) >= ASSIGN_STUCK_MS) {
    Serial.println("[NFC] assign slot stuck — force re-arm");
    readyForNextAssign();
    return;
  }

  if (_assignArmed && !_cardPresent && _lastTapMs != 0 &&
      (now - _lastTapMs) >= PERIODIC_RECOVER_MS &&
      (now - _lastRecoverMs) >= PERIODIC_RECOVER_MS) {
    recoverReader("periodic refresh");
    readyForNextAssign();
  }
}

bool NfcSubsystem::emitTap(const char* uid) {
  if (!_onTap || uid[0] == '\0') {
    return false;
  }
  const uint32_t now = millis();
  const uint32_t debounceMs = _assignMode ? ASSIGN_SAME_UID_MS : TAP_GLITCH_MS;
  if (strcmp(uid, _lastUid) == 0 && (now - _lastTapMs) < debounceMs) {
    return false;
  }
  strncpy(_lastUid, uid, sizeof(_lastUid) - 1);
  _lastTapMs = now;
  Serial.printf("[NFC] tap uid=%s\n", uid);
  _onTap(uid);
  if (_assignMode) {
    _rfQuietUntilMs = now + ASSIGN_RF_QUIET_MS;
    _lastPollMs = now;
  }
  return true;
}

void NfcSubsystem::pollRead() {
  const uint32_t now = millis();
  if ((now - _lastPollMs) < pollIntervalMs()) {
    return;
  }
  _lastPollMs = now;

  if (!_initialized) {
    if ((now - _lastIdleLogMs) > 60000) {
      _lastIdleLogMs = now;
      Serial.println("[NFC] reader unavailable — reboot or check wiring");
    }
    return;
  }

  char uid[24] = "";

  if (_assignMode) {
    tickAssignWatchdog(now);

    if (_rfQuietUntilMs != 0 && now < _rfQuietUntilMs) {
      return;
    }

    if (_cardPresent) {
      const bool present = readUid(uid);
      if (!present) {
        if (++_absentStreak >= ASSIGN_ABSENT_DEBOUNCE_POLLS) {
          _cardPresent = false;
          _absentStreak = 0;
          _assignArmed = true;
          _lastUid[0] = '\0';
          Serial.println("[NFC] card removed — ready for next tap");
        }
      } else {
        _absentStreak = 0;
      }
      return;
    }

    if (!_assignArmed) {
      _assignArmed = true;
    }

    const bool present = readUid(uid);
    if (present && uid[0] != '\0') {
      if (emitTap(uid)) {
        _cardPresent = true;
        _absentStreak = 0;
      }
      return;
    }

    if (!_healthy && _failStreak >= 3) {
      recoverReader("read failures");
      readyForNextAssign();
    }

    if ((now - _lastIdleLogMs) > 30000) {
      _lastIdleLogMs = now;
      Serial.printf("[NFC] admin reader listening — present card (armed=%d healthy=%d)\n",
                    _assignArmed ? 1 : 0, _healthy ? 1 : 0);
    }
    return;
  }

  if (_quietUntilMs != 0 && now < _quietUntilMs) {
    return;
  }

  if (_cardPresent) {
    bool present = readUid(uid);
    if (!present) {
      // One quick confirmation read. A single PN5180 miss on a card that is
      // still present must NOT be read as a lift — that would re-arm and fire a
      // spurious tap, closing the open session (the "count resets by itself"
      // bug). Only a sustained absence counts as a real removal.
      delay(8);
      present = readUid(uid);
    }
    if (!present) {
      if (++_absentStreak >= ABSENT_DEBOUNCE_POLLS) {
        _cardPresent = false;
        _absentStreak = 0;
        _quietUntilMs = 0;
        Serial.println("[NFC] card removed — ready for next tap");
      }
    } else {
      _absentStreak = 0;
    }
    return;
  }

  const bool present = readUid(uid);
  if (present) {
    _absentStreak = 0;
    _cardPresent = true;
    _quietUntilMs = now + POST_READ_QUIET_MS;
    emitTap(uid);
    return;
  }

  _absentStreak = 0;
  if ((now - _lastIdleLogMs) > 30000) {
    _lastIdleLogMs = now;
    Serial.println("[NFC] listening — present card to reader");
  }
}

uint32_t NfcSubsystem::pollIntervalMs() const {
  if (_assignMode) {
    return _cardPresent ? ABSENT_CHECK_MS : POLL_INTERVAL_MS;
  }
  return _cardPresent ? ABSENT_CHECK_MS : POLL_INTERVAL_MS;
}
