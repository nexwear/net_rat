#pragma once

#include <Arduino.h>

void generateUuid(char out[37]);
uint64_t epochMsNow(bool* tsValidOut);
void timeUtilMarkSynced();
