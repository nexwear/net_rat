#include "net/OfflineStore.h"
#include <Arduino.h>
#include <Preferences.h>
#include <cstring>

namespace {
constexpr const char* kCfgNs = "cfg";
constexpr const char* kOfflineStoreVerKey = "offlineStoreVer";
constexpr int kOfflineStoreVer = 3;
constexpr size_t kRecordBytes = 160;

void copyRecordToEvent(const uint8_t* buf, TelemetryEvent& ev) {
  memset(&ev, 0, sizeof(ev));
  const size_t n = sizeof(TelemetryEvent) < kRecordBytes ? sizeof(TelemetryEvent) : kRecordBytes;
  memcpy(&ev, buf, n);
}

bool isStaleSessionEvent(const TelemetryEvent& ev) {
  if (ev.type == TelemetryType::SESSION_UPDATE || ev.type == TelemetryType::SESSION_CLOSE) {
    return true;
  }
  if (ev.type == TelemetryType::SCAN) {
    const ScanKind kind = static_cast<ScanKind>(ev.scanKind);
    return kind == ScanKind::TAP_IN || kind == ScanKind::TAP_OUT || kind == ScanKind::AUTO_CLOSE;
  }
  return false;
}
}  // namespace

bool OfflineStore::validateQueueFile(size_t fileSize) {
  if (fileSize == 0) {
    return true;
  }
  if (kRecordSize == 0 || fileSize % kRecordSize != 0) {
    return false;
  }
  if (fileSize / kRecordSize > kMaxRecords) {
    return false;
  }
  return true;
}

void OfflineStore::resetQueue() {
  if (LittleFS.exists(kPath)) {
    LittleFS.remove(kPath);
  }
  File create = LittleFS.open(kPath, FILE_WRITE);
  if (create) {
    create.close();
  }
  _headOffset = 0;
  _depth = 0;
  _overflow = false;
}

bool OfflineStore::begin() {
  if (!LittleFS.begin(false)) {
    Serial.println("[FS] LittleFS corrupt — formatting...");
    if (!LittleFS.format() || !LittleFS.begin(false)) {
      Serial.println("[FS] LittleFS unavailable");
      return false;
    }
  }

  if (!LittleFS.exists(kPath)) {
    resetQueue();
    _ready = true;
    Serial.println("[FS] Offline queue ready (depth 0)");
    return true;
  }

  File f = LittleFS.open(kPath, FILE_READ);
  if (!f) {
    resetQueue();
    _ready = true;
    Serial.println("[FS] Offline queue reset (open failed)");
    return true;
  }

  const size_t fileSize = f.size();
  f.close();

  if (!validateQueueFile(fileSize)) {
    Serial.printf("[FS] corrupt queue (%u bytes) — resetting\n", static_cast<unsigned>(fileSize));
    resetQueue();
    _ready = true;
    return true;
  }

  _headOffset = 0;
  _depth = fileSize / kRecordSize;

  Preferences prefs;
  if (prefs.begin(kCfgNs, false)) {
    const int storeVer = prefs.getInt(kOfflineStoreVerKey, 1);
    if (storeVer < kOfflineStoreVer) {
      if (_depth > 0) {
        Serial.printf("[FS] migrating offline queue v%d — cleared %u stale events\n",
                      kOfflineStoreVer, static_cast<unsigned>(_depth));
        resetQueue();
      }
      prefs.putInt(kOfflineStoreVerKey, kOfflineStoreVer);
    }
    prefs.end();
  }

  if (_depth > kBootClearThreshold) {
    Serial.printf("[FS] queue depth %u too large — clearing for recovery\n",
                  static_cast<unsigned>(_depth));
    resetQueue();
  }

  _ready = true;
  Serial.printf("[FS] Offline queue ready (depth %u)\n", static_cast<unsigned>(_depth));
  return true;
}

bool OfflineStore::empty() const { return _depth == 0; }

void OfflineStore::purgeStaleSessionEvents() {
  if (!_ready || _depth == 0) {
    return;
  }

  File f = LittleFS.open(kPath, FILE_READ);
  if (!f) {
    resetQueue();
    return;
  }

  const size_t fileSize = f.size();
  if (!validateQueueFile(fileSize)) {
    f.close();
    resetQueue();
    return;
  }

  uint8_t buf[kRecordSize] = {};
  size_t dropped = 0;
  size_t kept = 0;
  resetQueue();

  for (size_t off = 0; off + kRecordSize <= fileSize; off += kRecordSize) {
    f.seek(off);
    if (f.read(buf, kRecordSize) != kRecordSize) {
      break;
    }
    TelemetryEvent ev{};
    copyRecordToEvent(buf, ev);
    if (isStaleSessionEvent(ev)) {
      dropped++;
      continue;
    }
    if (!push(ev)) {
      break;
    }
    kept++;
  }
  f.close();

  if (dropped > 0) {
    Serial.printf("[FS] purged %u stale session event(s) after reboot (kept %u)\n",
                  static_cast<unsigned>(dropped), static_cast<unsigned>(kept));
  }
}

bool OfflineStore::push(const TelemetryEvent& ev) {
  if (!_ready) {
    return false;
  }

  if (_depth >= kMaxRecords) {
    _overflow = true;
    return false;
  }

  File f = LittleFS.open(kPath, FILE_APPEND);
  if (!f) {
    return false;
  }

  uint8_t buf[kRecordSize] = {};
  memset(buf, 0, kRecordSize);
  const size_t n = sizeof(TelemetryEvent) < kRecordSize ? sizeof(TelemetryEvent) : kRecordSize;
  memcpy(buf, &ev, n);
  const bool ok = f.write(buf, kRecordSize) == kRecordSize;
  f.close();
  if (!ok) {
    return false;
  }

  _depth++;
  return true;
}

bool OfflineStore::pop(TelemetryEvent& ev) {
  if (!_ready || _depth == 0) {
    return false;
  }

  File f = LittleFS.open(kPath, FILE_READ);
  if (!f) {
    resetQueue();
    return false;
  }

  const size_t fileSize = f.size();
  if (!validateQueueFile(fileSize) || _headOffset + kRecordSize > fileSize) {
    f.close();
    Serial.println("[FS] queue corrupt during pop — resetting");
    resetQueue();
    return false;
  }

  f.seek(_headOffset);
  uint8_t buf[kRecordSize] = {};
  if (f.read(buf, kRecordSize) != kRecordSize) {
    f.close();
    resetQueue();
    return false;
  }
  f.close();

  copyRecordToEvent(buf, ev);
  _headOffset += kRecordSize;
  _depth--;

  if (_depth == 0 || _headOffset + kRecordSize > fileSize) {
    resetQueue();
  }
  return true;
}
