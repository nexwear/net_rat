#pragma once

#include "DeviceConfig.h"

// USB-serial configuration protocol used by the desktop flasher/configurator.
//
// The host sends newline-terminated commands at 115200 baud:
//   CFG {"ssid":"..","pass":"..","server":"http://..","module":"INPUT","label":".."}
//   STATUS
//   RESET
//
// The node answers with single-line JSON tagged with a prefix the host parses:
//   OK {"applied":true}            after a CFG is accepted
//   STATUS {"nodeId":"..", ...}    current configuration + state
//   ERR {"error":".."}             on a malformed command
// NOTE: namespace is SerialCfg — the Arduino core already defines a
// `SerialConfig` enum (SERIAL_8N1 et al.), so that name is taken.
namespace SerialCfg {

// Non-blocking: accumulates serial bytes, returns true once a full line is read.
bool readLine(String& out);

// Parse a "CFG {json}" line into cfg (wifi/server/module/label). Returns true if
// the line was a valid CFG command and cfg was updated.
bool applyCfg(const String& line, DeviceConfig& cfg);

// Emit "STATUS {json}" describing the current config and runtime state.
void printStatus(const DeviceConfig& cfg, const char* state);

// Emit an "OK {...}" / "ERR {...}" acknowledgement line.
void printOk(const char* detail);
void printErr(const char* error);

}  // namespace SerialCfg
