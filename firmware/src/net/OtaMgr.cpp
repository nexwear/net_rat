#include "net/OtaMgr.h"
#include "core/RuntimeFlags.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <esp_ota_ops.h>
#include <mbedtls/sha256.h>

namespace {
constexpr uint32_t kDownloadIdleTimeoutMs = 45000;
constexpr uint8_t kStatusLed = 2;

void bytesToHexLower(const uint8_t* in, size_t len, char* out) {
  for (size_t i = 0; i < len; i++) {
    sprintf(out + i * 2, "%02x", in[i]);
  }
  out[len * 2] = '\0';
}

void ledOtaPulse() {
  static bool on = false;
  on = !on;
  digitalWrite(kStatusLed, on ? HIGH : LOW);
}

int compareVersions(const String& a, const String& b) {
  int ai = 0;
  int bi = 0;
  while (ai < a.length() || bi < b.length()) {
    int av = 0;
    while (ai < a.length() && a[ai] != '.') {
      if (isDigit(a[ai])) {
        av = av * 10 + (a[ai] - '0');
      }
      ai++;
    }
    if (ai < a.length() && a[ai] == '.') {
      ai++;
    }

    int bv = 0;
    while (bi < b.length() && b[bi] != '.') {
      if (isDigit(b[bi])) {
        bv = bv * 10 + (b[bi] - '0');
      }
      bi++;
    }
    if (bi < b.length() && b[bi] == '.') {
      bi++;
    }

    if (av != bv) {
      return av - bv;
    }
  }
  return 0;
}
}  // namespace

OtaMgr::OtaMgr(const DeviceConfig& cfg, OfflineStore& store) : _cfg(cfg), _store(store) {}

bool OtaMgr::postJson(const String& path, const String& body, String* responseBody) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  const String url = _cfg.serverUrl + path;
  const bool useTls = _cfg.serverUrl.startsWith("https://");

  HTTPClient http;
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  const bool begun =
      useTls ? http.begin(secureClient, url) : http.begin(plainClient, url);
  if (!begun) {
    return false;
  }

  http.setConnectTimeout(8000);
  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Node-Token", _cfg.token);
  const int code = http.POST(body);
  if (responseBody) {
    *responseBody = http.getString();
  }
  http.end();
  return code >= 200 && code < 300;
}

bool OtaMgr::report(bool success, const String& fromVersion, const String& toVersion,
                    const char* detail) {
  JsonDocument doc;
  doc["nodeId"] = _cfg.nodeId;
  doc["fromVersion"] = fromVersion;
  doc["toVersion"] = toVersion;
  doc["success"] = success;
  doc["detail"] = detail;
  String body;
  serializeJson(doc, body);
  return postJson("/v1/ota/report", body, nullptr);
}

bool OtaMgr::checkForUpdate(String& outVersion, String& outUrl, String& outSha256) {
  JsonDocument doc;
  doc["nodeId"] = _cfg.nodeId;
  doc["fwVersion"] = _cfg.fwVersion.length() ? _cfg.fwVersion : String(FW_VERSION);
  doc["moduleType"] = _cfg.moduleType;
  String body;
  serializeJson(doc, body);

  String resp;
  if (!postJson("/v1/ota/check", body, &resp)) {
    Serial.println("[OTA] check failed (server unreachable?)");
    return false;
  }

  JsonDocument out;
  if (deserializeJson(out, resp) != DeserializationError::Ok) {
    return false;
  }
  if (!out["update"].as<bool>()) {
    return false;
  }

  outVersion = out["version"].as<String>();
  outUrl = out["url"].as<String>();
  outSha256 = out["sha256"].as<String>();
  return outVersion.length() > 0 && outUrl.length() > 0 && outSha256.length() == 64;
}

bool OtaMgr::downloadAndApply(const String& version, const String& url, const String& expectedSha256) {
  pinMode(kStatusLed, OUTPUT);
  gOtaActive.store(true);

  HTTPClient http;
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  const bool useTls = url.startsWith("https://");
  const bool begun =
      useTls ? http.begin(secureClient, url) : http.begin(plainClient, url);
  if (!begun) {
    gOtaActive.store(false);
    digitalWrite(kStatusLed, LOW);
    report(false, _cfg.fwVersion, version, "http begin failed");
    return false;
  }

  http.setConnectTimeout(8000);
  http.setTimeout(60000);
  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    http.end();
    gOtaActive.store(false);
    digitalWrite(kStatusLed, LOW);
    Serial.printf("[OTA] Download HTTP %d\n", code);
    report(false, _cfg.fwVersion, version, "download HTTP error");
    return false;
  }

  const int contentLen = http.getSize();
  Serial.printf("[OTA] Firmware size %d bytes\n", contentLen);

  if (!Update.begin(contentLen > 0 ? contentLen : UPDATE_SIZE_UNKNOWN, U_FLASH)) {
    http.end();
    gOtaActive.store(false);
    digitalWrite(kStatusLed, LOW);
    report(false, _cfg.fwVersion, version, "Update.begin failed");
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  mbedtls_sha256_context shaCtx;
  mbedtls_sha256_init(&shaCtx);
  mbedtls_sha256_starts(&shaCtx, 0);

  uint8_t buf[1024];
  size_t written = 0;
  uint32_t lastProgressMs = millis();
  uint32_t lastLogPct = 0;
  const size_t target =
      contentLen > 0 ? static_cast<size_t>(contentLen) : static_cast<size_t>(-1);

  while (written < target) {
    ledOtaPulse();

    const size_t avail = stream->available();
    if (avail > 0) {
      const size_t toRead =
          min(avail, min(sizeof(buf), contentLen > 0 ? target - written : sizeof(buf)));
      const size_t n = stream->readBytes(buf, toRead);
      if (n == 0) {
        break;
      }
      mbedtls_sha256_update(&shaCtx, buf, n);
      if (Update.write(buf, n) != n) {
        Update.abort();
        http.end();
        mbedtls_sha256_free(&shaCtx);
        gOtaActive.store(false);
        digitalWrite(kStatusLed, LOW);
        report(false, _cfg.fwVersion, version, "Update.write failed");
        return false;
      }
      written += n;
      lastProgressMs = millis();

      if (contentLen > 0) {
        const uint32_t pct = (written * 100) / static_cast<size_t>(contentLen);
        if (pct >= lastLogPct + 10) {
          lastLogPct = pct;
          Serial.printf("[OTA] Progress %u%%\n", pct);
        }
      }
      continue;
    }

    if (!http.connected() && stream->available() == 0) {
      if (contentLen > 0) {
        break;
      }
      if (written > 0) {
        break;
      }
    }

    if ((millis() - lastProgressMs) > kDownloadIdleTimeoutMs) {
      Serial.println("[OTA] Download timeout — no data");
      break;
    }
    delay(10);
  }
  http.end();

  if (contentLen > 0 && written < static_cast<size_t>(contentLen)) {
    Update.abort();
    mbedtls_sha256_free(&shaCtx);
    gOtaActive.store(false);
    digitalWrite(kStatusLed, LOW);
    report(false, _cfg.fwVersion, version, "incomplete download");
    return false;
  }

  uint8_t digest[32];
  mbedtls_sha256_finish(&shaCtx, digest);
  mbedtls_sha256_free(&shaCtx);

  char digestHex[65];
  bytesToHexLower(digest, 32, digestHex);
  if (!expectedSha256.equalsIgnoreCase(digestHex)) {
    Update.abort();
    gOtaActive.store(false);
    digitalWrite(kStatusLed, LOW);
    Serial.printf("[OTA] SHA256 mismatch expected=%s got=%s\n", expectedSha256.c_str(), digestHex);
    report(false, _cfg.fwVersion, version, "sha256 mismatch");
    return false;
  }

  ConfigStore::setPendingFwVersion(version);

  if (!Update.end(true)) {
    gOtaActive.store(false);
    digitalWrite(kStatusLed, LOW);
    report(false, _cfg.fwVersion, version, Update.errorString());
    return false;
  }

  report(true, _cfg.fwVersion, version, "flash ok");
  Serial.println("[OTA] Success — LED solid, rebooting...");
  digitalWrite(kStatusLed, HIGH);
  gOtaActive.store(false);
  delay(800);
  ESP.restart();
  return true;
}

void OtaMgr::handle(bool wifiUp, bool sessionOpen) {
  if (!wifiUp || _updateInProgress) {
    return;
  }

#ifdef OTA_CHECK_INTERVAL_MS
  const uint32_t checkMs = OTA_CHECK_INTERVAL_MS;
#else
  const uint32_t checkMs =
      static_cast<uint32_t>(_cfg.otaHrs > 0 ? _cfg.otaHrs : 6) * 3600000UL;
#endif

  const uint32_t now = millis();
  if (_lastCheckMs != 0 && (now - _lastCheckMs) < checkMs) {
    return;
  }
  _lastCheckMs = now;

  String version;
  String url;
  String sha256;
  if (!checkForUpdate(version, url, sha256)) {
    return;
  }

  Serial.printf("[OTA] Update available %s -> %s\n", _cfg.fwVersion.c_str(), version.c_str());

  if (compareVersions(version, _cfg.fwVersion) <= 0) {
    Serial.println("[OTA] Ignored — server offered same or older version");
    return;
  }

  if (sessionOpen) {
    Serial.println("[OTA] Deferred — session open");
    return;
  }
  if (!_store.empty()) {
    Serial.println("[OTA] Deferred — offline queue not empty");
    return;
  }

  _updateInProgress = true;
  Serial.printf("[OTA] Downloading %s\n", url.c_str());
  downloadAndApply(version, url, sha256);
  _updateInProgress = false;
}
