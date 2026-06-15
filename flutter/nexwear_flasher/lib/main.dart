import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_libserialport/flutter_libserialport.dart';

import 'flasher_service.dart';
import 'serial_config_service.dart';

void main() {
  runApp(const FlasherApp());
}

// Nexwear brand palette
const _brand = Color(0xFF3B82F6);
const _bg = Color(0xFF09090B);
const _surface = Color(0xFF111114);
const _surface1 = Color(0xFF18181C);
const _border = Color(0xFF2E2E36);
const _text = Color(0xFFF4F4F5);
const _text2 = Color(0xFFA1A1AA);
const _text3 = Color(0xFF6B7280);
const _ok = Color(0xFF22C55E);
const _factory = Color(0xFF22D3EE);
const _danger = Color(0xFFEF4444);

const _modules = ['INPUT', 'OUTPUT_1', 'OUTPUT_2', 'ADMIN'];

class FlasherApp extends StatelessWidget {
  const FlasherApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Nexwear Flasher',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: _bg,
        colorScheme: const ColorScheme.dark(primary: _brand, surface: _surface, onSurface: _text),
        fontFamily: 'Segoe UI',
      ),
      home: const FlasherHome(),
    );
  }
}

class FlasherHome extends StatefulWidget {
  const FlasherHome({super.key});
  @override
  State<FlasherHome> createState() => _FlasherHomeState();
}

class _FlasherHomeState extends State<FlasherHome> {
  final _flasher = FlasherService();
  final _serial = SerialConfigService();
  final _log = <String>[];
  final _scroll = ScrollController();

  // flash settings
  List<String> _ports = [];
  String? _port;
  int _baud = 921600;
  bool _eraseFirst = false;
  bool _useBundled = true;
  String? _customPath;

  // config form
  final _ssid = TextEditingController();
  final _pass = TextEditingController();
  final _server = TextEditingController(text: 'http://15.206.16.137/api');
  final _label = TextEditingController();
  String _module = 'INPUT';
  bool _configureAfterFlash = true;

  bool _busy = false;
  bool _serialOpen = false;
  String _status = 'Ready';
  Color _statusColor = _text3;

  static const _bauds = [921600, 460800, 230400, 115200];

  @override
  void initState() {
    super.initState();
    _refreshPorts();
  }

  @override
  void dispose() {
    _serial.close();
    _ssid.dispose();
    _pass.dispose();
    _server.dispose();
    _label.dispose();
    super.dispose();
  }

  void _refreshPorts() {
    setState(() {
      _ports = SerialPort.availablePorts;
      if (_port == null || !_ports.contains(_port)) {
        _port = _ports.isNotEmpty ? _ports.first : null;
      }
    });
  }

  void _append(String line) {
    if (!mounted) return;
    setState(() => _log.add(line));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  void _setStatus(String s, Color c) {
    if (!mounted) return;
    setState(() {
      _status = s;
      _statusColor = c;
    });
  }

  Future<void> _pickFile() async {
    final res = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['bin'],
      dialogTitle: 'Select firmware .bin',
    );
    if (res != null && res.files.single.path != null) {
      setState(() {
        _customPath = res.files.single.path;
        _useBundled = false;
      });
    }
  }

  // ── Flash ──────────────────────────────────────────────────────────
  Future<void> _flash() async {
    if (_port == null) return _setStatus('Select a COM port first', _danger);
    // esptool needs exclusive access to the port.
    _serial.close();
    setState(() {
      _busy = true;
      _serialOpen = false;
      _log.clear();
    });
    _setStatus('Flashing…', _brand);
    try {
      final fw = _useBundled ? await _flasher.extractBundledFirmware() : _customPath!;
      _append('Firmware: $fw');
      _append('Port: $_port @ $_baud baud');
      _append('');
      final code = await _flasher.flash(
        port: _port!,
        baud: _baud,
        firmwarePath: fw,
        eraseFirst: _eraseFirst,
        onLog: _append,
      );
      if (code != 0) {
        _setStatus('Flash failed (exit $code)', _danger);
        return;
      }
      _append('');
      _append('✓ Flash complete.');
      if (_configureAfterFlash) {
        _append('Waiting for node to boot…');
        await Future.delayed(const Duration(seconds: 4));
        await _configure();
      } else {
        _setStatus('Flashed — configure when ready', _ok);
      }
    } on EsptoolNotFound catch (e) {
      _append(e.message);
      _setStatus('esptool not found', _danger);
    } catch (e) {
      _append('Error: $e');
      _setStatus('Error: $e', _danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ── Configure over USB serial ──────────────────────────────────────
  Future<void> _configure() async {
    if (_port == null) return _setStatus('Select a COM port first', _danger);
    if (_ssid.text.trim().isEmpty) return _setStatus('WiFi SSID is required', _danger);

    if (!_serial.isOpen) {
      _append('');
      _append('── Opening $_port for configuration ──');
      final err = _serial.open(_port!, _append);
      if (err != null) {
        _append('Serial open failed: $err');
        _setStatus('Serial open failed', _danger);
        return;
      }
      setState(() => _serialOpen = true);
      // Opening the port can reset the board — let it boot before we send.
      await Future.delayed(const Duration(seconds: 3));
    }

    _serial.sendConfig(
      ssid: _ssid.text.trim(),
      pass: _pass.text,
      server: _server.text.trim(),
      module: _module,
      label: _label.text.trim(),
    );
    _append('→ Sent config (module $_module${_label.text.trim().isNotEmpty ? ', "${_label.text.trim()}"' : ''}).');
    _append('  Watching node — it will connect, claim, and print its node ID.');
    _setStatus('Config sent — node claiming…', _brand);
  }

  Future<void> _readStatus() async {
    if (_port == null) return _setStatus('Select a COM port first', _danger);
    if (!_serial.isOpen) {
      final err = _serial.open(_port!, _append);
      if (err != null) {
        _append('Serial open failed: $err');
        return;
      }
      setState(() => _serialOpen = true);
      await Future.delayed(const Duration(milliseconds: 600));
    }
    _serial.requestStatus();
    _append('→ STATUS requested');
  }

  void _disconnect() {
    _serial.close();
    setState(() => _serialOpen = false);
    _append('── Serial disconnected ──');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHeader(),
            const SizedBox(height: 18),
            Expanded(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 340,
                    child: SingleChildScrollView(child: _buildControls()),
                  ),
                  const SizedBox(width: 20),
                  Expanded(child: _buildConsole()),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      children: [
        const Text('Nex', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: _text, letterSpacing: -1)),
        const Text('wear', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: _brand, letterSpacing: -1)),
        const SizedBox(width: 10),
        _tag('ESP32 FLASHER + CONFIG'),
        const Spacer(),
        Text('firmware v${FlasherService.bundledVersion}', style: const TextStyle(fontSize: 12, color: _text3)),
      ],
    );
  }

  Widget _buildControls() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Step 1: device + firmware ──
        _card(
          title: '1 · Device & Firmware',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _label2('Serial Port'),
              Row(children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _port,
                    isExpanded: true,
                    decoration: _dec(),
                    dropdownColor: _surface1,
                    hint: const Text('No ports', style: TextStyle(color: _text3)),
                    items: _ports
                        .map((p) => DropdownMenuItem(value: p, child: Text(p, style: const TextStyle(color: _text))))
                        .toList(),
                    onChanged: _busy ? null : (v) => setState(() => _port = v),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  onPressed: _busy ? null : _refreshPorts,
                  icon: const Icon(Icons.refresh, color: _text2),
                  tooltip: 'Refresh ports',
                  style: IconButton.styleFrom(backgroundColor: _surface1, side: const BorderSide(color: _border)),
                ),
              ]),
              const SizedBox(height: 14),
              _label2('Baud Rate'),
              DropdownButtonFormField<int>(
                initialValue: _baud,
                isExpanded: true,
                decoration: _dec(),
                dropdownColor: _surface1,
                items: _bauds
                    .map((b) => DropdownMenuItem(value: b, child: Text('$b', style: const TextStyle(color: _text))))
                    .toList(),
                onChanged: _busy ? null : (v) => setState(() => _baud = v!),
              ),
              const SizedBox(height: 14),
              _label2('Firmware'),
              _radio('Bundled  (v${FlasherService.bundledVersion})', _useBundled, () => setState(() => _useBundled = true)),
              _radio(_customPath == null ? 'Custom file…' : _short(_customPath!), !_useBundled, _pickFile),
              CheckboxListTile(
                value: _eraseFirst,
                onChanged: _busy ? null : (v) => setState(() => _eraseFirst = v ?? false),
                title: const Text('Erase flash first', style: TextStyle(fontSize: 13, color: _text2)),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
                dense: true,
                activeColor: _brand,
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        // ── Step 2: configuration ──
        _card(
          title: '2 · Node Configuration',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _field('WiFi SSID', _ssid, hint: 'factory network'),
              _field('WiFi Password', _pass, hint: 'leave blank if open', obscure: true),
              _field('Server URL', _server, mono: true),
              const SizedBox(height: 4),
              _label2('Module Type'),
              DropdownButtonFormField<String>(
                initialValue: _module,
                isExpanded: true,
                decoration: _dec(),
                dropdownColor: _surface1,
                items: _modules
                    .map((m) => DropdownMenuItem(value: m, child: Text(m, style: const TextStyle(color: _text))))
                    .toList(),
                onChanged: _busy ? null : (v) => setState(() => _module = v!),
              ),
              const SizedBox(height: 12),
              _field('Label (optional)', _label, hint: 'e.g. Line 1 – Elastic'),
              const SizedBox(height: 2),
              const Text(
                'The node ID is issued by the server when the node claims itself; it appears below after configuring.',
                style: TextStyle(fontSize: 11, color: _text3, height: 1.4),
              ),
              CheckboxListTile(
                value: _configureAfterFlash,
                onChanged: _busy ? null : (v) => setState(() => _configureAfterFlash = v ?? false),
                title: const Text('Configure automatically after flashing', style: TextStyle(fontSize: 13, color: _text2)),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
                dense: true,
                activeColor: _brand,
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        // ── Actions ──
        FilledButton.icon(
          onPressed: _busy || _port == null ? null : _flash,
          icon: _busy
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.bolt, size: 18),
          label: Text(_busy ? 'Working…' : 'Flash Device'),
          style: FilledButton.styleFrom(
            backgroundColor: _brand,
            minimumSize: const Size(double.infinity, 46),
          ),
        ),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _busy || _port == null ? null : _configure,
              icon: const Icon(Icons.settings_ethernet, size: 16),
              label: const Text('Configure'),
              style: OutlinedButton.styleFrom(
                foregroundColor: _text, side: const BorderSide(color: _border), minimumSize: const Size(0, 42)),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _busy || _port == null ? null : _readStatus,
              icon: const Icon(Icons.info_outline, size: 16),
              label: const Text('Status'),
              style: OutlinedButton.styleFrom(
                foregroundColor: _text, side: const BorderSide(color: _border), minimumSize: const Size(0, 42)),
            ),
          ),
        ]),
        if (_serialOpen) ...[
          const SizedBox(height: 8),
          TextButton.icon(
            onPressed: _disconnect,
            icon: const Icon(Icons.link_off, size: 16, color: _text3),
            label: const Text('Disconnect serial', style: TextStyle(color: _text3, fontSize: 12)),
          ),
        ],
        const SizedBox(height: 10),
        Row(children: [
          Icon(Icons.circle, size: 8, color: _statusColor),
          const SizedBox(width: 6),
          Expanded(child: Text(_status, style: TextStyle(fontSize: 12, color: _statusColor))),
        ]),
      ],
    );
  }

  Widget _buildConsole() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: _surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const Text('OUTPUT',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: _text3, letterSpacing: 1)),
            if (_serialOpen) ...[
              const SizedBox(width: 8),
              const Icon(Icons.usb, size: 13, color: _ok),
              const SizedBox(width: 3),
              const Text('serial live', style: TextStyle(fontSize: 10, color: _ok)),
            ],
            const Spacer(),
            if (_log.isNotEmpty)
              IconButton(
                iconSize: 16,
                onPressed: () => setState(() => _log.clear()),
                icon: const Icon(Icons.clear_all, color: _text3),
                tooltip: 'Clear',
              ),
          ]),
          const SizedBox(height: 8),
          Expanded(
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF050507),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: _border),
              ),
              child: _log.isEmpty
                  ? const Center(
                      child: Text('Flash, then configure — node output appears here',
                          style: TextStyle(color: _text3, fontSize: 13)))
                  : ListView.builder(
                      controller: _scroll,
                      itemCount: _log.length,
                      itemBuilder: (_, i) => Text(
                        _log[i],
                        style: TextStyle(fontFamily: 'Consolas', fontSize: 12, height: 1.5, color: _logColor(_log[i])),
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Color _logColor(String l) {
    final low = l.toLowerCase();
    if (l.contains('✓') || l.startsWith('STATUS ') || low.contains('verified') || low.contains('active')) return _ok;
    if (l.startsWith('ERR') || l.contains('✗') || low.contains('error') || low.contains('fail')) return _danger;
    if (l.startsWith('→') || l.startsWith('\$') || l.startsWith('──') || l.startsWith('OK ')) return _brand;
    if (l.startsWith('[')) return _factory;
    return _text2;
  }

  // ── helpers ─────────────────────────────────────────────────────────
  Widget _card({required String title, required Widget child}) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: _surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: _border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title.toUpperCase(),
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: _text2, letterSpacing: 0.8)),
            const SizedBox(height: 14),
            child,
          ],
        ),
      );

  Widget _field(String label, TextEditingController c, {String? hint, bool obscure = false, bool mono = false}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _label2(label),
            TextField(
              controller: c,
              obscureText: obscure,
              enabled: !_busy,
              style: TextStyle(color: _text, fontSize: 13, fontFamily: mono ? 'Consolas' : null),
              decoration: _dec(hint: hint),
            ),
          ],
        ),
      );

  Widget _label2(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(t.toUpperCase(),
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: _text3, letterSpacing: 0.8)),
      );

  Widget _radio(String label, bool selected, VoidCallback onTap) => InkWell(
        onTap: _busy ? null : onTap,
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(children: [
            Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off, size: 18, color: selected ? _brand : _text3),
            const SizedBox(width: 8),
            Expanded(child: Text(label, style: const TextStyle(fontSize: 13, color: _text2))),
          ]),
        ),
      );

  Widget _tag(String t) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: _surface1, borderRadius: BorderRadius.circular(5), border: Border.all(color: _border)),
        child: Text(t, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: _text2, letterSpacing: 1)),
      );

  InputDecoration _dec({String? hint}) => InputDecoration(
        isDense: true,
        hintText: hint,
        hintStyle: const TextStyle(color: _text3, fontSize: 12),
        filled: true,
        fillColor: _surface1,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(6), borderSide: const BorderSide(color: _border)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(6), borderSide: const BorderSide(color: _brand)),
        disabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(6), borderSide: const BorderSide(color: _border)),
      );

  String _short(String p) {
    final parts = p.split(RegExp(r'[\\/]'));
    return parts.length > 1 ? '…\\${parts.last}' : p;
  }
}
