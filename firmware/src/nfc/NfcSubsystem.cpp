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
  nfc->readEEprom(PRODUCT_VERSION, productVersion, sizeof(productVersion));
  return productVersion[1] != 0xFF;
}

void tryRecoverReader(PN5180ISO14443* nfc, uint8_t& failStreak, bool& healthy) {
  if (++failStreak < 3) {
    return;
  }
  failStreak = 0;
  healthy = false;
  Serial.println("[NFC] RF setup failed — re-initializing PN5180");
  nfc->begin();
  nfc->reset();
  healthy = pn5180Responding(nfc);
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
  Serial.printf("[NFC] PN5180 ready (product 0x%02X%02X)\n", productVersion[0], productVersion[1]);
  return true;
}

bool NfcSubsystem::readUid14443(char out[24]) {
  gIso14443->reset();
  if (!gIso14443->setupRF()) {
    tryRecoverReader(gIso14443, _failStreak, _healthy);
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
  gIso15693->reset();
  if (!gIso15693->setupRF()) {
    tryRecoverReader(gIso14443, _failStreak, _healthy);
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
  if (readUid14443(out)) {
    return true;
  }
  return readUid15693(out);
}

void NfcSubsystem::emitTap(const char* uid) {
  if (!_onTap || uid[0] == '\0') {
    return;
  }
  const uint32_t now = millis();
  if (strcmp(uid, _lastUid) == 0 && (now - _lastTapMs) < TAP_GLITCH_MS) {
    return;
  }
  strncpy(_lastUid, uid, sizeof(_lastUid) - 1);
  _lastTapMs = now;
  Serial.printf("[NFC] tap uid=%s\n", uid);
  _onTap(uid);
}

void NfcSubsystem::pollRead() {
  const uint32_t now = millis();
  if ((now - _lastPollMs) < pollIntervalMs()) {
    return;
  }
  _lastPollMs = now;

  char uid[24] = "";

  if (_assignMode) {
    const bool present = readUid(uid);
    if (present && uid[0] != '\0') {
      if (!_cardPresent) {
        _cardPresent = true;
        emitTap(uid);
      } else if (strcmp(uid, _lastUid) != 0) {
        emitTap(uid);
      }
      _absentStreak = 0;
      return;
    }

    if (_cardPresent) {
      if (++_absentStreak >= ASSIGN_ABSENT_DEBOUNCE_POLLS) {
        _cardPresent = false;
        _absentStreak = 0;
        _lastUid[0] = '\0';
        Serial.println("[NFC] card removed — ready for next tap");
      }
    } else {
      _absentStreak = 0;
      if ((now - _lastIdleLogMs) > 30000) {
        _lastIdleLogMs = now;
        Serial.println("[NFC] admin reader listening — present card");
      }
    }
    return;
  }

  if (_quietUntilMs != 0 && now < _quietUntilMs) {
    return;
  }

  if (_cardPresent) {
    const bool present = readUid(uid);
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
    return _cardPresent ? ASSIGN_ABSENT_CHECK_MS : POLL_INTERVAL_MS;
  }
  return _cardPresent ? ABSENT_CHECK_MS : POLL_INTERVAL_MS;
}
