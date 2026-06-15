#pragma once

#include "types.h"
#include <LittleFS.h>

class OfflineStore {
 public:
  bool begin();
  bool push(const TelemetryEvent& ev);
  bool pop(TelemetryEvent& ev);
  void resetQueue();
  bool empty() const;
  size_t depth() const { return _depth; }
  bool overflow() const { return _overflow; }

 private:
  bool validateQueueFile(size_t fileSize);

  static constexpr const char* kPath = "/q.log";
  static constexpr size_t kRecordSize = 160;
  static constexpr size_t kMaxRecords = 4000;
  static constexpr size_t kBootClearThreshold = 64;

  size_t _headOffset = 0;
  size_t _depth = 0;
  bool _overflow = false;
  bool _ready = false;
};
