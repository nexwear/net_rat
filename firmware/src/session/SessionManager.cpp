#include "session/SessionManager.h"
#include "DeviceConfig.h"
#include "core/RuntimeFlags.h"
#include "util/TimeUtil.h"
#include <cstring>

SessionManager::SessionManager(const DeviceConfig& cfg, std::vector<CounterDriver*>& drivers,
                               QueueHandle_t telemetryQ, uint32_t* seqCounter)
    : _cfg(cfg), _drivers(drivers), _telemetryQ(telemetryQ), _seqCounter(seqCounter) {}

uint32_t SessionManager::deltaFor(DriverId id) const {
  for (auto* d : _drivers) {
    if (d && d->id() == id) {
      const uint8_t idx = static_cast<uint8_t>(id);
      const uint32_t base = _baseline[idx].used ? _baseline[idx].value : 0;
      return d->total() - base;
    }
  }
  return 0;
}

uint32_t SessionManager::passCount() const {
  ModuleType mt = moduleTypeFromString(_cfg.moduleType);
  if (mt == ModuleType::OUTPUT_2) {
    return deltaFor(DriverId::PRESS);
  }
  return deltaFor(DriverId::HORSESHOE);
}

uint32_t SessionManager::cycleCount() const {
  ModuleType mt = moduleTypeFromString(_cfg.moduleType);
  if (mt == ModuleType::MOD_INPUT) {
    return deltaFor(DriverId::CURRENT);
  }
  if (mt == ModuleType::OUTPUT_1) {
    return deltaFor(DriverId::HALL);
  }
  return 0;
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
  }
}

void SessionManager::emit(TelemetryType type, ScanKind scanKind, CloseReason reason) {
  TelemetryEvent ev{};
  ev.type = type;
  generateUuid(ev.eventId);
  ev.seq = ++(*_seqCounter);
  if ((_seqCounter != nullptr) && (*_seqCounter % 32 == 0)) {
    ConfigStore::saveSeq(*_seqCounter);
  }
  strncpy(ev.cardUid, _activeCardUid, sizeof(ev.cardUid) - 1);
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

  xQueueSend(_telemetryQ, &ev, 0);

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
  uint32_t total = 0;
  for (auto* d : _drivers) {
    if (!d) continue;
    if (mt == ModuleType::MOD_INPUT && d->id() == DriverId::CURRENT) {
      total = d->total();
    } else if (mt == ModuleType::OUTPUT_1 && d->id() == DriverId::HALL) {
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

  strncpy(gCardLookup.cardUid, cardUid, sizeof(gCardLookup.cardUid) - 1);
  gCardLookup.cardUid[sizeof(gCardLookup.cardUid) - 1] = '\0';
  gCardLookup.pending.store(true);

  emit(TelemetryType::SCAN, kind);
  Serial.printf("[SESSION] open uid=%s session=%s\n", cardUid, _sessionId);
  Serial.println("[SESSION] tap-out: remove card, then tap same card again");
  emit(TelemetryType::SESSION_UPDATE);
  _lastEmitMs = millis();
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
    if (d->id() == DriverId::CURRENT || d->id() == DriverId::HALL) {
      _unassignedBaselineCycle = d->total();
    }
  }
}

void SessionManager::onTap(const char* cardUid, ScanKind kindOverride) {
  const uint32_t now = millis();
  const bool admin = moduleTypeFromString(_cfg.moduleType) == ModuleType::ADMIN;

  if (admin) {
    strncpy(_activeCardUid, cardUid, sizeof(_activeCardUid) - 1);
    emit(TelemetryType::SCAN, ScanKind::ASSIGN_SCAN);
    _activeCardUid[0] = '\0';
    return;
  }

  if (hasOpenSession()) {
    if (strcmp(cardUid, _activeCardUid) == 0) {
      closeSession(CloseReason::TAP_OUT, ScanKind::TAP_OUT);
    } else {
      closeSession(CloseReason::NEXT_TAP, ScanKind::AUTO_CLOSE);
      openSession(cardUid, kindOverride);
    }
  } else {
    openSession(cardUid, kindOverride);
  }

  strncpy(_lastTapUid, cardUid, sizeof(_lastTapUid) - 1);
  _lastTapMs = now;
}

void SessionManager::tick() {
  const uint32_t now = millis();

  if (hasOpenSession()) {
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
