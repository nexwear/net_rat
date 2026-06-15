#pragma once

#include <atomic>

inline std::atomic<bool> gSessionOpen{false};
inline std::atomic<bool> gOtaActive{false};

struct CardLookupRequest {
  std::atomic<bool> pending{false};
  char cardUid[24] = "";
};

inline CardLookupRequest gCardLookup;
