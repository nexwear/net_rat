import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_libserialport/flutter_libserialport.dart';

/// Talks the node's USB-serial configuration protocol (see firmware
/// `SerialCfg`): sends `CFG {json}`, `STATUS`, `RESET`, and streams the node's
/// line-oriented replies/logs back to the UI.
class SerialConfigService {
  SerialPort? _port;
  SerialPortReader? _reader;
  final StringBuffer _rx = StringBuffer();

  bool get isOpen => _port != null;

  /// Open [portName] at 115200 8N1 and stream complete lines to [onLine].
  /// Returns an error string on failure, or null on success.
  String? open(String portName, void Function(String line) onLine) {
    close();
    final p = SerialPort(portName);
    if (!p.openReadWrite()) {
      final err = SerialPort.lastError?.message ?? 'cannot open $portName';
      p.dispose();
      return err;
    }
    final cfg = SerialPortConfig()
      ..baudRate = 115200
      ..bits = 8
      ..parity = SerialPortParity.none
      ..stopBits = 1
      ..setFlowControl(SerialPortFlowControl.none);
    p.config = cfg;
    cfg.dispose();

    _port = p;
    final reader = SerialPortReader(p, timeout: 2000);
    _reader = reader;
    reader.stream.listen(
      (data) => _ingest(data, onLine),
      onError: (_) {},
      cancelOnError: false,
    );
    return null;
  }

  void _ingest(Uint8List data, void Function(String) onLine) {
    _rx.write(String.fromCharCodes(data));
    var s = _rx.toString();
    int idx;
    while ((idx = s.indexOf('\n')) >= 0) {
      final line = s.substring(0, idx).replaceAll('\r', '').trimRight();
      if (line.isNotEmpty) onLine(line);
      s = s.substring(idx + 1);
    }
    _rx
      ..clear()
      ..write(s);
  }

  void _send(String cmd) {
    final p = _port;
    if (p == null) return;
    p.write(Uint8List.fromList(utf8.encode('$cmd\n')));
  }

  /// Push WiFi + server + module + label to the node.
  void sendConfig({
    required String ssid,
    required String pass,
    required String server,
    required String module,
    required String label,
  }) {
    final json = jsonEncode({
      'ssid': ssid,
      'pass': pass,
      'server': server,
      'module': module,
      'label': label,
    });
    _send('CFG $json');
  }

  void requestStatus() => _send('STATUS');
  void factoryReset() => _send('RESET');

  void close() {
    try {
      _reader?.close();
    } catch (_) {}
    try {
      _port?.close();
      _port?.dispose();
    } catch (_) {}
    _reader = null;
    _port = null;
    _rx.clear();
  }
}
