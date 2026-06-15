import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;
import 'package:path_provider/path_provider.dart';

/// Thrown when no esptool implementation can be located on the system.
class EsptoolNotFound implements Exception {
  final String message;
  EsptoolNotFound(this.message);
  @override
  String toString() => message;
}

/// Wraps esptool to flash the bundled (or a custom) firmware image to an ESP32
/// over USB serial. The merged image is flashed at offset 0x0.
class FlasherService {
  static const String bundledAsset = 'assets/firmware/nexwear-firmware-1.0.14.bin';
  static const String bundledVersion = '1.0.14';

  /// Resolve how to invoke esptool: returns (executable, leadingArgs).
  /// Search order: bundled tools\esptool.exe → esptool.exe on PATH →
  /// esptool.py on PATH (via python) → `python -m esptool`.
  Future<(String, List<String>)> _resolveEsptool() async {
    final exeDir = File(Platform.resolvedExecutable).parent.path;
    final bundled = File('$exeDir${Platform.pathSeparator}tools'
        '${Platform.pathSeparator}esptool.exe');
    if (await bundled.exists()) return (bundled.path, <String>[]);

    if (await _which('esptool.exe') != null) return ('esptool.exe', <String>[]);

    final py = await _which('esptool.py');
    if (py != null) return ('python', <String>[py]);

    if (await _which('python.exe') != null || await _which('python') != null) {
      return ('python', <String>['-m', 'esptool']);
    }

    throw EsptoolNotFound(
      'esptool not found.\n'
      'Either drop esptool.exe into the app\'s tools\\ folder, '
      'or install Python and run "pip install esptool".',
    );
  }

  Future<String?> _which(String name) async {
    try {
      final r = await Process.run('where', [name], runInShell: true);
      if (r.exitCode == 0) {
        final first = (r.stdout as String).split('\n').first.trim();
        if (first.isNotEmpty) return first;
      }
    } catch (_) {}
    return null;
  }

  /// Available serial ports are enumerated in the UI via flutter_libserialport.

  /// Write the bundled firmware asset to a temp file and return its path.
  Future<String> extractBundledFirmware() async {
    final data = await rootBundle.load(bundledAsset);
    final dir = await getTemporaryDirectory();
    final f = File('${dir.path}${Platform.pathSeparator}'
        'nexwear-firmware-$bundledVersion.bin');
    await f.writeAsBytes(data.buffer.asUint8List(), flush: true);
    return f.path;
  }

  /// Flash [firmwarePath] to [port]. Streams every esptool output line to
  /// [onLog]. Returns the process exit code (0 = success).
  Future<int> flash({
    required String port,
    required int baud,
    required String firmwarePath,
    required bool eraseFirst,
    required void Function(String line) onLog,
  }) async {
    final (exe, prefix) = await _resolveEsptool();

    if (eraseFirst) {
      onLog('\$ esptool --chip esp32 --port $port erase_flash');
      final code = await _run(
        exe,
        [...prefix, '--chip', 'esp32', '--port', port, '--baud', '$baud', 'erase_flash'],
        onLog,
      );
      if (code != 0) {
        onLog('✗ Erase failed (exit $code)');
        return code;
      }
    }

    final args = <String>[
      ...prefix,
      '--chip', 'esp32',
      '--port', port,
      '--baud', '$baud',
      '--before', 'default_reset',
      '--after', 'hard_reset',
      'write_flash', '-z',
      '0x0', firmwarePath,
    ];
    onLog('\$ esptool ${args.where((a) => !prefix.contains(a)).join(' ')}');
    return _run(exe, args, onLog);
  }

  Future<int> _run(String exe, List<String> args, void Function(String) onLog) async {
    final proc = await Process.start(exe, args, runInShell: true);
    proc.stdout
        .transform(const Utf8Decoder(allowMalformed: true))
        .transform(const LineSplitter())
        .listen((l) => onLog(l.trimRight()));
    proc.stderr
        .transform(const Utf8Decoder(allowMalformed: true))
        .transform(const LineSplitter())
        .listen((l) => onLog(l.trimRight()));
    return proc.exitCode;
  }
}
