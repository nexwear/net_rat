#include "drivers/InputPieceFusion.h"
#include <Arduino.h>
#include <cstring>

InputPieceFusion::InputPieceFusion(CurrentDriver* current, HorseshoeIrDriver* horseshoe)
    : _current(current), _ir(horseshoe) {}

void InputPieceFusion::recordRunEnd(uint32_t ms) {
  _runEndMs[_runEndHead] = ms;
  _runEndHead = static_cast<uint8_t>((_runEndHead + 1) % kRunHistory);
}

bool InputPieceFusion::hadRunNear(uint32_t ms) const {
  for (uint8_t i = 0; i < kRunHistory; ++i) {
    const uint32_t end = _runEndMs[i];
    if (end == 0) {
      continue;
    }
    if (ms >= end && (ms - end) <= RUN_NEAR_MS) {
      return true;
    }
    if (end >= ms && (end - ms) <= RUN_NEAR_MS) {
      return true;
    }
  }
  return false;
}

void InputPieceFusion::tryCountPiece(uint32_t now, const char* reason) {
  if (_lastPieceMs != 0 && (now - _lastPieceMs) < PIECE_COOLDOWN_MS) {
    return;
  }
  _pieces++;
  _lastPieceMs = now;
  Serial.printf("[FUSION] piece #%lu (%s)\n", static_cast<unsigned long>(_pieces), reason);
}

void InputPieceFusion::onRunEnded(uint32_t now) {
  const uint32_t duration = now - _runStartMs;
  recordRunEnd(now);
  if (_peakAmps >= MIN_PEAK_A && duration >= MIN_RUN_MS) {
    tryCountPiece(now, "current-run");
  }
}

void InputPieceFusion::onIrLift(uint32_t atMs) {
  // Lift shortly after a motor run, or lift while current still elevated → one piece.
  if (hadRunNear(atMs)) {
    tryCountPiece(atMs, "run+ir");
    return;
  }
  const float amps = _current ? _current->aux() : 0.0f;
  if (amps >= RUN_OFF_A) {
    tryCountPiece(atMs, "ir-during-run");
  }
}

void InputPieceFusion::poll() {
  if (!_current || !_ir) {
    return;
  }

  const float amps = _current->aux();
  const uint32_t now = millis();

  uint32_t liftMs = 0;
  while (_ir->consumeLiftEvent(liftMs)) {
    onIrLift(liftMs);
  }

  if (!_running) {
    if (amps >= RUN_ON_A) {
      _running = true;
      _runStartMs = now;
      _peakAmps = amps;
      _offSinceMs = 0;
    }
    return;
  }

  if (amps > _peakAmps) {
    _peakAmps = amps;
  }

  if (amps < RUN_OFF_A) {
    if (_offSinceMs == 0) {
      _offSinceMs = now;
    } else if ((now - _offSinceMs) >= MIN_OFF_MS) {
      onRunEnded(now);
      _running = false;
      _offSinceMs = 0;
      _peakAmps = 0.0f;
    }
  } else {
    _offSinceMs = 0;
  }
}
