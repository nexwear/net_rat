import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import '../widgets/tab_helpers.dart';

class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key, required this.refreshTick});
  final int refreshTick;

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  final _api = ApiClient.instance;
  List<dynamic> _alerts = [];
  bool _loading = true;
  String? _error;
  bool _showResolved = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant AlertsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.refreshTick != oldWidget.refreshTick) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _api.getAlerts(resolved: _showResolved);
      if (!mounted) return;
      setState(() {
        _alerts = data;
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

  Future<void> _ack(String id) async {
    try {
      await _api.ackAlert(id);
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
          child: Row(
            children: [
              ChoiceChip(
                label: const Text('Open'),
                selected: !_showResolved,
                onSelected: (_) {
                  if (_showResolved) {
                    setState(() => _showResolved = false);
                    _load();
                  }
                },
              ),
              const SizedBox(width: 8),
              ChoiceChip(
                label: const Text('Resolved'),
                selected: _showResolved,
                onSelected: (_) {
                  if (!_showResolved) {
                    setState(() => _showResolved = true);
                    _load();
                  }
                },
              ),
            ],
          ),
        ),
        Expanded(child: _buildList()),
      ],
    );
  }

  Widget _buildList() {
    if (_loading && _alerts.isEmpty) return tabLoading();
    if (_error != null && _alerts.isEmpty) return tabError(_error!, onRetry: _load);

    return RefreshIndicator(
      onRefresh: _load,
      color: NW.brand,
      backgroundColor: NW.surface,
      child: _alerts.isEmpty
          ? tabEmpty(_showResolved ? 'No resolved alerts' : 'No open alerts')
          : ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: _alerts.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _alertTile(_alerts[i] as Map<String, dynamic>),
            ),
    );
  }

  Widget _alertTile(Map<String, dynamic> a) {
    final sev = a['severity']?.toString() ?? 'MED';
    final id = a['id']?.toString();
    final resolved = a['resolved_at'] != null;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: NW.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: statusColor(sev).withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  a['type']?.toString() ?? 'ALERT',
                  style: const TextStyle(fontWeight: FontWeight.w700, color: NW.text, fontSize: 13),
                ),
              ),
              StatusChip(sev, color: statusColor(sev)),
            ],
          ),
          if (a['detail'] != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(a['detail'].toString(), style: const TextStyle(fontSize: 12, color: NW.text2)),
            ),
          const SizedBox(height: 6),
          Text(timeSince(a['created_at']), style: const TextStyle(fontSize: 11, color: NW.text3)),
          if (!resolved && id != null)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () => _ack(id),
                child: const Text('Acknowledge'),
              ),
            ),
        ],
      ),
    );
  }
}
