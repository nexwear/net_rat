#include "net/OfflineStore.h"
#include <Arduino.h>
#include <cstring>

bool OfflineStore::begin() {
  if (!LittleFS.begin(false)) {
    Serial.println("[FS] LittleFS corrupt — formatting...");
    if (!LittleFS.format() || !LittleFS.begin(false)) {
      Serial.println("[FS] LittleFS unavailable");
      return false;
    }
  }

  if (!LittleFS.exists(kPath)) {
    File create = LittleFS.open(kPath, FILE_WRITE);
    if (create) {
      create.close();
    }
  }

  _file = LittleFS.open(kPath, FILE_APPEND);
  if (!_file) {
    _file = LittleFS.open(kPath, FILE_WRITE);
  }
  _ready = static_cast<bool>(_file);
  if (_ready) {
    _depth = _file.size() / kRecordSize;
    _file.close();
    Serial.printf("[FS] Offline queue ready (depth %u)\n", static_cast<unsigned>(_depth));
  }
  return _ready;
}

bool OfflineStore::empty() const { return _depth == 0; }

bool OfflineStore::push(const TelemetryEvent& ev) {
  if (!_ready) return false;

  File f = LittleFS.open(kPath, FILE_APPEND);
  if (!f) return false;

  uint8_t buf[kRecordSize] = {};
  memcpy(buf, &ev, sizeof(TelemetryEvent) > kRecordSize ? kRecordSize : sizeof(TelemetryEvent));
  f.write(buf, kRecordSize);
  f.close();

  _depth++;
  if (_depth > kMaxRecords) {
    _overflow = true;
    // Drop oldest: truncate front by rewriting is expensive; flag overflow for MVP
    _depth = kMaxRecords;
  }
  return true;
}

bool OfflineStore::pop(TelemetryEvent& ev) {
  if (!_ready || _depth == 0) return false;

  File f = LittleFS.open(kPath, FILE_READ);
  if (!f) return false;

  uint8_t buf[kRecordSize] = {};
  if (f.read(buf, kRecordSize) != kRecordSize) {
    f.close();
    return false;
  }
  f.close();
  memcpy(&ev, buf, sizeof(TelemetryEvent));

  // Shift file: read remainder and rewrite (simple MVP)
  File src = LittleFS.open(kPath, FILE_READ);
  File dst = LittleFS.open("/q.tmp", FILE_WRITE);
  if (!src || !dst) {
    if (src) src.close();
    if (dst) dst.close();
    return false;
  }
  src.seek(kRecordSize);
  while (src.available()) {
    dst.write(src.read());
  }
  src.close();
  dst.close();
  LittleFS.remove(kPath);
  LittleFS.rename("/q.tmp", kPath);

  _depth--;
  return true;
}
