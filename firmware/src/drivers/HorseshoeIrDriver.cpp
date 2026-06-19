#include "drivers/HorseshoeIrDriver.h"

HorseshoeIrDriver::HorseshoeIrDriver(uint8_t pin) : _pin(pin) {}

void HorseshoeIrDriver::begin() {
  pinMode(_pin, INPUT_PULLUP);
  _lastRaw = digitalRead(_pin);
  _state = State::IDLE;
  _stateMs = millis();
  _outStableBlocked = false;
  _outCandidateBlocked = false;
  _outCandidateMs = millis();
  _outState = OutState::CLEAR;
  _outBlockQualified = false;
}

void HorseshoeIrDriver::registerBreak() {
  const uint32_t now = millis();
  _rawBreaks++;
  if (_lastBreakMs == 0 || (now - _lastBreakMs) > GROUP_GAP_MS) {
    _groups++;
  }
  _lastBreakMs = now;
}

bool HorseshoeIrDriver::consumeLiftEvent(uint32_t& atMs) {
  if (!_pendingLift) {
    return false;
  }
  _pendingLift = false;
  atMs = _pendingLiftMs;
  return true;
}

void HorseshoeIrDriver::poll() {
  if (_mode == PieceCountMode::OUTPUT_STRICT) {
    pollOutputStrict();
  } else {
    pollInputLift();
  }
}

void HorseshoeIrDriver::pollInputLift() {
  const bool raw = digitalRead(_pin);
  const uint32_t now = millis();

  if (raw != _lastRaw) {
    _lastRaw = raw;
    _stateMs = now;
  }

  switch (_state) {
    case State::IDLE:
      if (!raw && (now - _stateMs) >= DEBOUNCE_MS) {
        _state = State::BLOCKED;
        _stateMs = now;
        _cycleStartMs = now;
      }
      break;
    case State::BLOCKED:
      if (!raw && (now - _stateMs) >= MIN_BLOCK_MS) {
        _state = State::CONFIRMED;
      } else if (raw && (now - _stateMs) >= DEBOUNCE_MS) {
        _state = State::IDLE;
      }
      break;
    case State::CONFIRMED:
      if (raw && (now - _stateMs) >= DEBOUNCE_MS) {
        const uint32_t dwell = now - _cycleStartMs;
        if (dwell >= MIN_BLOCK_MS) {
          _pendingLift = true;
          _pendingLiftMs = now;
        }
        if (dwell >= MIN_PIECE_MS) {
          registerBreak();
        }
        _state = State::IDLE;
        _stateMs = now;
      }
      break;
  }
}

void HorseshoeIrDriver::pollOutputStrict() {
  const bool raw = digitalRead(_pin);
  const bool blocked = !raw;
  const uint32_t now = millis();

  if (blocked != _outCandidateBlocked) {
    _outCandidateBlocked = blocked;
    _outCandidateMs = now;
  }

  if ((now - _outCandidateMs) >= OUT_GLITCH_MS && blocked != _outStableBlocked) {
    _outStableBlocked = blocked;

    if (blocked) {
      if (_outState == OutState::CLEARING && (now - _outClearStartMs) < OUT_MIN_CLEAR_MS) {
        // Clear ended early — restart block timing; do not count.
        _outBlockStartMs = now;
        _outBlockQualified = false;
        _outState = OutState::BLOCKED;
        return;
      }
      _outBlockStartMs = now;
      _outBlockQualified = false;
      _outState = OutState::BLOCKED;
      return;
    }

    // Stable clear (beam restored).
    if (_outState == OutState::BLOCKED && _outBlockQualified) {
      _outClearStartMs = now;
      _outState = OutState::CLEARING;
    } else {
      _outState = OutState::CLEAR;
      _outBlockQualified = false;
    }
    return;
  }

  if (_outState == OutState::BLOCKED && !_outBlockQualified) {
    if ((now - _outBlockStartMs) >= OUT_MIN_BLOCK_MS) {
      _outBlockQualified = true;
    }
    return;
  }

  if (_outState == OutState::CLEARING && _outBlockQualified) {
    if ((now - _outClearStartMs) >= OUT_MIN_CLEAR_MS) {
      registerBreak();
      _outBlockQualified = false;
      _outState = OutState::CLEAR;
    }
  }
}
