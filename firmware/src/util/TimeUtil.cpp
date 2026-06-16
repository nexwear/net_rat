#include "util/TimeUtil.h"
#include <esp_random.h>
#include <time.h>

static bool gTimeSynced = false;

void generateUuid(char out[37]) {
  uint8_t b[16];
  esp_fill_random(b, sizeof(b));
  b[6] = (b[6] & 0x0F) | 0x40;
  b[8] = (b[8] & 0x3F) | 0x80;
  snprintf(out, 37, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12],
           b[13], b[14], b[15]);
}

void timeUtilMarkSynced() { gTimeSynced = true; }

bool timeUtilIsSynced() { return gTimeSynced; }

uint64_t epochMsNow(bool* tsValidOut) {
  if (tsValidOut) {
    *tsValidOut = gTimeSynced;
  }
  if (gTimeSynced) {
    timeval tv{};
    gettimeofday(&tv, nullptr);
    return (static_cast<uint64_t>(tv.tv_sec) * 1000ULL) + (tv.tv_usec / 1000);
  }
  return millis();
}
