#include "net/OfflineStore.h"
#include <Arduino.h>
#include <Preferences.h>
#include <cstring>

namespace {
constexpr const char* kCfgNs = "cfg";
constexpr const char* kOfflineStoreVerKey = "offlineStoreVer";
constexpr int kOfflineStoreVer = 2;
}  // namespace

bool OfflineStore::validateQueueFile(size_t fileSize) {
  if (fileSize == 0) {
    return true;
  }
  if (fileSize % kRecordSize != 0) {
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
    if (storeVer < kOfflineStoreVer && _depth > 0) {
      Serial.printf("[FS] migrating offline queue — cleared %u stale events\n",
                    static_cast<unsigned>(_depth));
      resetQueue();
    }
    if (storeVer < kOfflineStoreVer) {
      prefs.putInt(kOfflineStoreVerKey, kOfflineStoreVer);
    }
    prefs.end();
  }

  _ready = true;
  Serial.printf("[FS] Offline queue ready (depth %u)\n", static_cast<unsigned>(_depth));
  return true;
}

bool OfflineStore::empty() const { return _depth == 0; }

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
  memcpy(buf, &ev, sizeof(TelemetryEvent) > kRecordSize ? kRecordSize : sizeof(TelemetryEvent));
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

  memcpy(&ev, buf, sizeof(TelemetryEvent));
  _headOffset += kRecordSize;
  _depth--;

  if (_depth == 0) {
    resetQueue();
  }
  return true;
}
