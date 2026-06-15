import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import '../widgets/tab_helpers.dart';

class BundlesScreen extends StatefulWidget {
  const BundlesScreen({super.key, required this.refreshTick});
  final int refreshTick;

  @override
  State<BundlesScreen> createState() => _BundlesScreenState();
}

class _BundlesScreenState extends State<BundlesScreen> {
  final _api = ApiClient.instance;
  List<dynamic> _bundles = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant BundlesScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.refreshTick != oldWidget.refreshTick) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _api.getBundles();
      if (!mounted) return;
      setState(() {
        _bundles = data;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _bundles.isEmpty) return tabLoading();
    if (_error != null && _bundles.isEmpty) return tabError(_error!, onRetry: _load);

    return RefreshIndicator(
      onRefresh: _load,
      color: NW.brand,
      backgroundColor: NW.surface,
      child: _bundles.isEmpty
          ? tabEmpty('No bundles yet')
          : ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: _bundles.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _bundleTile(_bundles[i] as Map<String, dynamic>),
            ),
    );
  }

  Widget _bundleTile(Map<String, dynamic> b) {
    final status = b['status']?.toString() ?? '—';
    final id = b['id']?.toString() ?? '—';
    final shortId = id.length > 8 ? '${id.substring(0, 8)}…' : id;
    final pieces = n(b['declared_pieces']);
    final line = b['line_name']?.toString() ?? 'Line ${b['line_id'] ?? '—'}';
    final card = b['assigned_card_number'] ?? b['assigned_card_uid'];
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: NW.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: NW.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(shortId, style: const TextStyle(fontWeight: FontWeight.w700, color: NW.text))),
              StatusChip(status, color: statusColor(status)),
            ],
          ),
          const SizedBox(height: 6),
          Text('$line · $pieces pcs', style: const TextStyle(fontSize: 12, color: NW.text2)),
          if (b['contractor_name'] != null)
            Text(b['contractor_name'].toString(), style: const TextStyle(fontSize: 11, color: NW.text3)),
          if (card != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('Card: $card', style: const TextStyle(fontSize: 11, color: NW.brand)),
            ),
        ],
      ),
    );
  }
}
