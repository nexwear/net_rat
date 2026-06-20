#include "drivers/InputPieceFusion.h"
#include <Arduino.h>

InputPieceFusion::InputPieceFusion(CurrentDriver* current, HorseshoeIrDriver* horseshoe)
    : _current(current), _ir(horseshoe) {}

void InputPieceFusion::resetCycle() {
  _phase = Phase::IDLE;
  _runStartMs = 0;
  _lowHoldStartMs = 0;
  _offSinceMs = 0;
  _peakAmps = 0.0f;
  _irLiftsThisCycle = 0;
}

bool InputPieceFusion::tryCountPiece(uint32_t now, const char* reason) {
  if (_lastPieceMs != 0 && (now - _lastPieceMs) < PIECE_COOLDOWN_MS) {
    return false;
  }
  _pieces++;
  _lastPieceMs = now;
  Serial.printf("[FUSION] piece #%lu (%s", static_cast<unsigned long>(_pieces), reason);
  if (_irLiftsThisCycle > 0) {
    Serial.printf("+ir=%u", _irLiftsThisCycle);
  }
  Serial.printf(") peak=%.2f\n", _peakAmps);
  return true;
}

void InputPieceFusion::noteIrLift(uint32_t atMs) {
  (void)atMs;
  // IR is logged for reference only (shown as +ir=N on a counted piece). Pieces
  // are detected from the current burst alone, so IR is not required.
  if (_phase == Phase::RUNNING || _phase == Phase::LOW_HOLD) {
    _irLiftsThisCycle++;
  }
}

void InputPieceFusion::finishPiece(uint32_t now, const char* reason) {
  const uint32_t duration =
      _runStartMs > 0 ? now - _runStartMs : (_lowHoldStartMs > 0 ? now - _lowHoldStartMs : 0);
  if (_peakAmps >= MIN_PEAK_A && duration >= MIN_RUN_MS) {
    tryCountPiece(now, reason);
  }
  resetCycle();
}

void InputPieceFusion::poll() {
  if (!_current || !_ir) {
    return;
  }

  const float amps = _current->aux();
  const uint32_t now = millis();

  // Throttled live current log for threshold tuning (skips dead idle to cut spam).
  if ((now - _lastAmpsLogMs) >= AMPS_LOG_MS && (amps >= 0.05f || _phase != Phase::IDLE)) {
    _lastAmpsLogMs = now;
    static const char* const kPhase[] = {"IDLE", "RUN", "LOW"};
    Serial.printf("[CUR] a=%.2f phase=%s peak=%.2f\n", amps,
                  kPhase[static_cast<int>(_phase)], _peakAmps);
  }

  uint32_t liftMs = 0;
  while (_ir->consumeLiftEvent(liftMs)) {
    noteIrLift(liftMs);
  }

  switch (_phase) {
    case Phase::IDLE:
      if (amps >= RUN_ON_A) {
        _phase = Phase::RUNNING;
        _runStartMs = now;
        _peakAmps = amps;
        _offSinceMs = 0;
        _irLiftsThisCycle = 0;
      }
      break;

    case Phase::RUNNING:
      if (amps > _peakAmps) {
        _peakAmps = amps;
      }

      if (amps < RUN_OFF_A) {
        if (_offSinceMs == 0) {
          _offSinceMs = now;
        }
        const uint32_t offMs = now - _offSinceMs;
        if (amps < IDLE_MIN_A && offMs >= MIN_OFF_MS) {
          finishPiece(now, "burst-end");
        } else if (amps >= IDLE_MIN_A && offMs >= MIN_OFF_MS) {
          _phase = Phase::LOW_HOLD;
          _lowHoldStartMs = now;
          _offSinceMs = 0;
        }
      } else {
        _offSinceMs = 0;
      }
      break;

    case Phase::LOW_HOLD:
      if (amps >= RUN_ON_A) {
        _phase = Phase::RUNNING;
        _offSinceMs = 0;
        if (amps > _peakAmps) {
          _peakAmps = amps;
        }
        break;
      }

      if (amps < IDLE_MIN_A) {
        if (_offSinceMs == 0) {
          _offSinceMs = now;
        } else if ((now - _offSinceMs) >= MIN_OFF_MS) {
          finishPiece(now, "burst-end-low");
        }
      } else {
        _offSinceMs = 0;
      }

      if (_lowHoldStartMs > 0 && (now - _lowHoldStartMs) > LOW_HOLD_MAX_MS) {
        finishPiece(now, "low-hold-timeout");
      }
      break;
  }
}
