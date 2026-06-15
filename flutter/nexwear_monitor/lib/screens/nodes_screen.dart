import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import '../widgets/tab_helpers.dart';

class NodesScreen extends StatefulWidget {
  const NodesScreen({super.key, required this.refreshTick});
  final int refreshTick;

  @override
  State<NodesScreen> createState() => _NodesScreenState();
}

class _NodesScreenState extends State<NodesScreen> {
  final _api = ApiClient.instance;
  List<dynamic> _nodes = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant NodesScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.refreshTick != oldWidget.refreshTick) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _api.getNodes();
      if (!mounted) return;
      setState(() {
        _nodes = data;
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
    if (_loading && _nodes.isEmpty) return tabLoading();
    if (_error != null && _nodes.isEmpty) return tabError(_error!, onRetry: _load);

    return RefreshIndicator(
      onRefresh: _load,
      color: NW.brand,
      backgroundColor: NW.surface,
      child: _nodes.isEmpty
          ? tabEmpty('No nodes registered')
          : ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: _nodes.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _nodeTile(_nodes[i] as Map<String, dynamic>),
            ),
    );
  }

  Widget _nodeTile(Map<String, dynamic> n) {
    final status = n['status']?.toString() ?? '—';
    final id = n['id']?.toString() ?? '—';
    final module = n['module_type']?.toString() ?? '—';
    final fw = n['fw_version']?.toString() ?? '—';
    final rssi = n['rssi'];
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
              Expanded(
                child: Text(id, style: const TextStyle(fontWeight: FontWeight.w700, color: NW.text, fontSize: 13)),
              ),
              StatusChip(status, color: statusColor(status)),
            ],
          ),
          const SizedBox(height: 8),
          Text('$module · fw $fw', style: const TextStyle(fontSize: 12, color: NW.text2)),
          const SizedBox(height: 4),
          Text(
            'Last seen ${timeSince(n['last_seen_at'])}${rssi != null ? ' · RSSI $rssi' : ''}',
            style: const TextStyle(fontSize: 11, color: NW.text3),
          ),
          if (n['label'] != null && n['label'].toString().isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(n['label'].toString(), style: const TextStyle(fontSize: 11, color: NW.text3)),
            ),
        ],
      ),
    );
  }
}
