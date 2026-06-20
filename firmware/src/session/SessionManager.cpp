#include "session/SessionManager.h"
#include "DeviceConfig.h"
#include "core/RuntimeFlags.h"
#include "util/TimeUtil.h"
#include <cstring>

SessionManager::SessionManager(const DeviceConfig& cfg, std::vector<CounterDriver*>& drivers,
                               QueueHandle_t telemetryQ, uint32_t* seqCounter, BuzzerDriver* buzzer)
    : _cfg(cfg), _drivers(drivers), _telemetryQ(telemetryQ), _seqCounter(seqCounter),
      _buzzer(buzzer) {}

uint32_t SessionManager::deltaFor(DriverId id) const {
  for (auto* d : _drivers) {
    if (d && d->id() == id) {
      const uint8_t idx = static_cast<uint8_t>(id);
      if (!_baseline[idx].used) return d->total();
      // (total - snapshot) is this session's new work; + offset continues the
      // count from the resumed cloud value after a reboot/resync.
      return d->total() - _baseline[idx].value + _baseline[idx].offset;
    }
  }
  return 0;
}

uint32_t SessionManager::rotationDelta() const {
  return deltaFor(DriverId::HALL);
}

uint32_t SessionManager::horseshoeGroups() const {
  return deltaFor(DriverId::HORSESHOE);
}

uint32_t SessionManager::quantumEstimate() const {
  const uint32_t rot = rotationDelta();
  if (_ppp < MIN_PPP || rot == 0) return 0;
  return static_cast<uint32_t>((rot / _ppp) + 0.5f);
}

// count_pass = pieces. INPUT uses current+IR fusion; OUTPUT_1 uses horseshoe
// groups or hall/ppp estimate; OUTPUT_2 uses press cycles.
uint32_t SessionManager::passCount() const {
  ModuleType mt = moduleTypeFromString(_cfg.moduleType);
  if (mt == ModuleType::OUTPUT_2) {
    return deltaFor(DriverId::PRESS);
  }
  if (mt == ModuleType::MOD_INPUT) {
    return deltaFor(DriverId::FUSION);
  }
  const uint32_t groups = horseshoeGroups();
  const uint32_t est = quantumEstimate();
  return groups > est ? groups : est;
}

// count_cycle = raw stitching work (motor rotations). This is what the server
// divides by the true OUTPUT_2 count to calibrate PPP per style+size. The
// press station has no rotary sensor, so it reports 0.
uint32_t SessionManager::cycleCount() const {
  ModuleType mt = moduleTypeFromString(_cfg.moduleType);
  if (mt == ModuleType::OUTPUT_2) {
    return 0;
  }
  if (mt == ModuleType::MOD_INPUT) {
    return deltaFor(DriverId::CURRENT);
  }
  return rotationDelta();
}

// While a worker is lifting the horseshoe we have an independent piece count
// (groups) alongside the rotation total, so we can learn this style's PPP live
// and apply it to subsequent non-lifting workers without waiting for the
// server's OUTPUT_2 reconciliation.
void SessionManager::updateLiveCalibration() {
  ModuleType mt = moduleTypeFromString(_cfg.moduleType);
  if (mt != ModuleType::MOD_INPUT && mt != ModuleType::OUTPUT_1) return;

  const uint32_t groups = horseshoeGroups();
  const uint32_t rot = rotationDelta();
  if (groups < CALIB_MIN_GROUPS || rot == 0) return;

  const float sample = static_cast<float>(rot) / static_cast<float>(groups);
  if (sample < MIN_PPP || sample > MAX_PPP) return;

  _ppp = (_ppp * (1.0f - CALIB_BLEND)) + (sample * CALIB_BLEND);
}

void SessionManager::setPpp(uint32_t ppp) {
  if (ppp == 0) return;
  float v = static_cast<float>(ppp);
  if (v < MIN_PPP) v = MIN_PPP;
  if (v > MAX_PPP) v = MAX_PPP;
  _ppp = v;
  Serial.printf("[SESSION] PPP set to %.0f pulses/piece\n", _ppp);
}

float SessionManager::liveAmps() const {
  for (auto* d : _drivers) {
    if (d && d->id() == DriverId::CURRENT) {
      return d->aux();
    }
  }
  return 0.0f;
}

void SessionManager::snapshotBaselines() {
  for (auto* d : _drivers) {
    if (!d) continue;
    const uint8_t idx = static_cast<uint8_t>(d->id());
    _baseline[idx].used = true;
    _baseline[idx].value = d->total();
    _baseline[idx].offset = 0;
  }
}

// Continue the reported count from the cloud value (targetPass/targetCycle)
// regardless of where the local sensor totals are. We snapshot the current total
// (so new work counts from 0) and put the cloud count in the offset. This works
// after a reboot (totals reset to 0) where the old "baseline = total - target"
// could not, because an unsigned baseline can't go negative.
void SessionManager::adjustBaselinesForResume(uint32_t targetPass, uint32_t targetCycle) {
  const ModuleType mt = moduleTypeFromString(_cfg.moduleType);
  for (auto* d : _drivers) {
    if (!d) continue;
    const uint8_t idx = static_cast<uint8_t>(d->id());
    const DriverId did = d->id();
    _baseline[idx].used = true;
    _baseline[idx].value = d->total();  // new work counts from here
    uint32_t offset = 0;
    if (mt == ModuleType::OUTPUT_2 && did == DriverId::PRESS) {
      offset = targetPass;
    } else if (mt == ModuleType::MOD_INPUT && did == DriverId::FUSION) {
      offset = targetPass;
    } else if (mt == ModuleType::MOD_INPUT && did == DriverId::CURRENT) {
      offset = targetCycle;
    } else if (mt == ModuleType::OUTPUT_1 && did == DriverId::HORSESHOE) {
      offset = targetPass;
    } else if (mt == ModuleType::OUTPUT_1 && did == DriverId::HALL) {
      offset = targetCycle;
    }
    _baseline[idx].offset = offset;
  }
}

void SessionManager::resumeSession(const char* cardUid, const char* sessionId, uint32_t pass,
                                   uint32_t cycle, uint32_t declared, uint32_t ppp,
                                   uint64_t startEpochMs) {
  if (hasOpenSession()) {
    return;
  }
  if (moduleTypeFromString(_cfg.moduleType) == ModuleType::ADMIN) {
    return;
  }
  if (!cardUid || !cardUid[0] || !sessionId || !sessionId[0]) {
    return;
  }

  strncpy(_activeCardUid, cardUid, sizeof(_activeCardUid) - 1);
  _activeCardUid[sizeof(_activeCardUid) - 1] = '\0';
  strncpy(_sessionId, sessionId, sizeof(_sessionId) - 1);
  _sessionId[sizeof(_sessionId) - 1] = '\0';

  _startMs = millis();
  if (startEpochMs > 0) {
    bool tsValid = false;
    const uint64_t nowMs = epochMsNow(&tsValid);
    if (tsValid && nowMs > startEpochMs) {
      const uint64_t elapsed = nowMs - startEpochMs;
      if (elapsed < SESSION_TIMEOUT_MS) {
        _startMs = millis() - static_cast<uint32_t>(elapsed);
      }
    }
  }
  _lastEmitMs = _startMs;
  _cachedDeclared = declared;
  _qtyReachedMs = 0;
  if (ppp > 0) {
    setPpp(ppp);
  }

  snapshotBaselines();
  adjustBaselinesForResume(pass, cycle);
  _lastReportedPass = passCount();
  _lastReportedCycle = cycleCount();
  gSessionOpen.store(true);

  emit(TelemetryType::SESSION_UPDATE);
  _lastEmitMs = millis();
  Serial.printf("[SESSION] resumed uid=%s session=%s pass=%lu cycle=%lu\n", _activeCardUid,
                _sessionId, passCount(), cycleCount());
  Serial.println("[SESSION] tap-out: remove card, then tap same card again");
}

void SessionManager::emit(TelemetryType type, ScanKind scanKind, CloseReason reason,
                          const char* cardUidOverride) {
  TelemetryEvent ev{};
  ev.type = type;
  generateUuid(ev.eventId);
  // Sequence is persisted by NetTask on the heartbeat cadence — never write NVS
  // from this counting path (flash writes stall both cores' cache).
  ev.seq = ++(*_seqCounter);
  if (cardUidOverride && cardUidOverride[0] != '\0') {
    strncpy(ev.cardUid, cardUidOverride, sizeof(ev.cardUid) - 1);
  } else {
    strncpy(ev.cardUid, _activeCardUid, sizeof(ev.cardUid) - 1);
  }
  strncpy(ev.sessionId, _sessionId, sizeof(ev.sessionId) - 1);
  ev.countPass = passCount();
  ev.countCycle = cycleCount();
  ev.currentAmps = liveAmps();
  ev.scanKind = static_cast<uint8_t>(scanKind);
  ev.closeReason = static_cast<uint8_t>(reason);
  ev.tsEpochMs = epochMsNow(&ev.tsValid);

  if (type == TelemetryType::UNASSIGNED) {
    ev.countPass = _unassignedPass;
    ev.countCycle = _unassignedCycle;
    ev.cardUid[0] = '\0';
    ev.sessionId[0] = '\0';
  }

  if (xQueueSend(_telemetryQ, &ev, pdMS_TO_TICKS(50)) != pdTRUE) {
    Serial.printf("[TELEM] queue full — dropped %s\n",
                  type == TelemetryType::SCAN ? "SCAN" : "event");
    return;
  }

  if (type == TelemetryType::SCAN) {
    Serial.printf("[TELEM] SCAN %s uid=%s\n", scanKindToString(scanKind), ev.cardUid);
  } else if (type == TelemetryType::SESSION_UPDATE) {
    Serial.printf("[TELEM] UPDATE pass=%lu cycle=%lu\n", ev.countPass, ev.countCycle);
  } else if (type == TelemetryType::SESSION_CLOSE) {
    Serial.printf("[TELEM] CLOSE pass=%lu cycle=%lu reason=%s\n", ev.countPass, ev.countCycle,
                  closeReasonToString(reason));
  }
}

bool SessionManager::deltaChangedBy(uint32_t k) {
  const uint32_t pass = passCount();
  const uint32_t cycle = cycleCount();
  const bool changed =
      (pass > _lastReportedPass ? pass - _lastReportedPass : _lastReportedPass - pass) >= k ||
      (cycle > _lastReportedCycle ? cycle - _lastReportedCycle : _lastReportedCycle - cycle) >= k;
  _lastReportedPass = pass;
  _lastReportedCycle = cycle;
  return changed;
}

uint32_t SessionManager::unassignedPassCount() const {
  ModuleType mt = moduleTypeFromString(_cfg.moduleType);
  uint32_t total = 0;
  for (auto* d : _drivers) {
    if (!d) continue;
    if (mt == ModuleType::OUTPUT_2 && d->id() == DriverId::PRESS) {
      total = d->total();
    } else if (mt != ModuleType::OUTPUT_2 && d->id() == DriverId::HORSESHOE) {
      total = d->total();
    }
  }
  return total > _unassignedBaselinePass ? total - _unassignedBaselinePass : 0;
}

uint32_t SessionManager::unassignedCycleCount() const {
  ModuleType mt = moduleTypeFromString(_cfg.moduleType);
  if (mt != ModuleType::MOD_INPUT && mt != ModuleType::OUTPUT_1) return 0;
  uint32_t total = 0;
  for (auto* d : _drivers) {
    if (d && d->id() == DriverId::HALL) {
      total = d->total();
    }
  }
  return total > _unassignedBaselineCycle ? total - _unassignedBaselineCycle : 0;
}

void SessionManager::openSession(const char* cardUid, ScanKind kind) {
  strncpy(_activeCardUid, cardUid, sizeof(_activeCardUid) - 1);
  generateUuid(_sessionId);
  _startMs = millis();
  _lastEmitMs = _startMs;
  _cachedDeclared = 0;
  _qtyReachedMs = 0;
  snapshotBaselines();
  _lastReportedPass = passCount();
  _lastReportedCycle = cycleCount();
  gSessionOpen.store(true);

  if (gCardLookupQ) {
    CardLookupMsg msg{};
    strncpy(msg.cardUid, cardUid, sizeof(msg.cardUid) - 1);
    xQueueOverwrite(gCardLookupQ, &msg);  // latest tap wins; held until NetTask online
  }

  if (_buzzer) _buzzer->play(BuzzPattern::TAP_IN);

  emit(TelemetryType::SCAN, kind);
  Serial.printf("[SESSION] open uid=%s session=%s ppp=%.0f\n", cardUid, _sessionId, _ppp);
  Serial.println("[SESSION] tap-out: remove card, then tap same card again");
}

void SessionManager::setCloudSessionId(const char* sessionId) {
  syncFromCloud(sessionId, 0, 0, 0);
}

void SessionManager::syncFromCloud(const char* sessionId, uint32_t cloudPass, uint32_t cloudCycle,
                                   uint32_t declared) {
  if (!hasOpenSession()) {
    return;
  }

  bool idChanged = false;
  if (sessionId && sessionId[0] && strcmp(_sessionId, sessionId) != 0) {
    strncpy(_sessionId, sessionId, sizeof(_sessionId) - 1);
    _sessionId[sizeof(_sessionId) - 1] = '\0';
    idChanged = true;
    Serial.printf("[SESSION] cloud session id %s\n", _sessionId);
  }

  if (declared > 0 && _cachedDeclared == 0) {
    setDeclaredPieces(declared);
  }

  const uint32_t localPass = passCount();
  const uint32_t localCycle = cycleCount();
  const bool countsBehind =
      (cloudPass > localPass) || (cloudCycle > localCycle && cloudCycle > 0);

  if (countsBehind) {
    adjustBaselinesForResume(cloudPass, cloudCycle);
    _lastReportedPass = passCount();
    _lastReportedCycle = cycleCount();
    Serial.printf("[SESSION] cloud sync pass=%lu cycle=%lu\n", passCount(), cycleCount());
  }

  if (idChanged) {
    emit(TelemetryType::SESSION_UPDATE);
    _lastEmitMs = millis();
  }
}

void SessionManager::abortUnassignedSession() {
  if (!hasOpenSession()) {
    return;
  }
  Serial.println("[SESSION] aborted — card has no bundle assigned");
  if (_buzzer) {
    _buzzer->play(BuzzPattern::ERROR);
  }
  closeSession(CloseReason::TAP_OUT, ScanKind::TAP_OUT);
}

void SessionManager::setDeclaredPieces(uint32_t pieces) {
  _cachedDeclared = pieces;
  _qtyReachedMs = 0;
  if (pieces > 0) {
    Serial.printf("[SESSION] bundle declared=%lu pieces (quantity auto-close enabled)\n", pieces);
  } else if (hasOpenSession()) {
    Serial.println("[SESSION] card unassigned — tap-out or timeout to close");
  }
}

void SessionManager::closeSession(CloseReason reason, ScanKind scanKind) {
  if (_buzzer) {
    _buzzer->play(reason == CloseReason::QUANTITY ? BuzzPattern::QUANTITY_DONE
                                                  : BuzzPattern::TAP_OUT);
  }
  emit(TelemetryType::SESSION_CLOSE, scanKind, reason);
  Serial.printf("[SESSION] closed uid=%s reason=%s pass=%lu cycle=%lu\n", _activeCardUid,
                closeReasonToString(reason), passCount(), cycleCount());
  _activeCardUid[0] = '\0';
  _sessionId[0] = '\0';
  _cachedDeclared = 0;
  _qtyReachedMs = 0;
  gSessionOpen.store(false);
  for (auto* d : _drivers) {
    if (!d) continue;
    if (d->id() == DriverId::HORSESHOE || d->id() == DriverId::PRESS) {
      _unassignedBaselinePass = d->total();
    }
    if (d->id() == DriverId::HALL) {
      _unassignedBaselineCycle = d->total();
    }
  }
}

void SessionManager::onTap(const char* cardUid, ScanKind kindOverride) {
  const uint32_t now = millis();
  const bool admin = moduleTypeFromString(_cfg.moduleType) == ModuleType::ADMIN;

  if (admin) {
    emit(TelemetryType::SCAN, ScanKind::ASSIGN_SCAN, CloseReason::TIMEOUT, cardUid);
    strncpy(_lastTapUid, cardUid, sizeof(_lastTapUid) - 1);
    _lastTapMs = now;
    return;
  }

  if (hasOpenSession()) {
    if (strcmp(cardUid, _activeCardUid) == 0) {
      // Same card = tap-out (close the bundle). Reject a re-read landing inside
      // the guard window so a flaky PN5180 — which can momentarily lose a card
      // that is still present — cannot auto-close a session just opened. This is
      // the cause of sessions/counts appearing to "reset" on their own.
      if ((now - _startMs) < TAP_OUT_WINDOW_MS) {
        Serial.printf("[SESSION] same-card tap %lums after open — ignored (guard)\n",
                      static_cast<unsigned long>(now - _startMs));
        return;
      }
      closeSession(CloseReason::TAP_OUT, ScanKind::TAP_OUT);  // plays TAP_OUT
    } else {
      // A different card while a bundle is open → reject with the error tone.
      // The worker must tap the active card to close it before starting another,
      // so an open bundle's count is never silently orphaned by a wrong tap.
      if (_buzzer) _buzzer->play(BuzzPattern::ERROR);
      Serial.printf("[SESSION] tap uid=%s REJECTED — bundle %s still open\n", cardUid,
                    _activeCardUid);
    }
  } else {
    openSession(cardUid, kindOverride);  // plays TAP_IN
  }

  strncpy(_lastTapUid, cardUid, sizeof(_lastTapUid) - 1);
  _lastTapMs = now;
}

void SessionManager::tick() {
  const uint32_t now = millis();

  if (hasOpenSession()) {
    updateLiveCalibration();
    if ((now - _lastEmitMs) > SESSION_UPDATE_MS || deltaChangedBy(DELTA_EMIT_THRESHOLD)) {
      emit(TelemetryType::SESSION_UPDATE);
      _lastEmitMs = now;
    }
    if (_cachedDeclared > 0 && passCount() >= _cachedDeclared) {
      if (_qtyReachedMs == 0) {
        _qtyReachedMs = now;
        Serial.printf("[SESSION] quantity reached %lu/%lu — grace period\n", passCount(),
                      _cachedDeclared);
      } else if ((now - _qtyReachedMs) > QTY_GRACE_MS) {
        closeSession(CloseReason::QUANTITY, ScanKind::AUTO_CLOSE);
        return;
      }
    } else {
      _qtyReachedMs = 0;
    }
    if ((now - _startMs) > SESSION_TIMEOUT_MS) {
      closeSession(CloseReason::TIMEOUT, ScanKind::AUTO_CLOSE);
    }
    return;
  }

  const uint32_t pass = unassignedPassCount();
  const uint32_t cycle = unassignedCycleCount();
  _unassignedPass = pass;
  _unassignedCycle = cycle;

  if (pass > 0 || cycle > 0) {
    if ((now - _lastUnassignedEmitMs) > UNASSIGNED_EMIT_MS) {
      emit(TelemetryType::UNASSIGNED);
      _lastUnassignedEmitMs = now;
      _unassignedBaselinePass += pass;
      _unassignedBaselineCycle += cycle;
    }
  }
}
