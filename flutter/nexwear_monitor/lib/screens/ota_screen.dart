import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import '../widgets/tab_helpers.dart';

class OtaScreen extends StatefulWidget {
  const OtaScreen({super.key, required this.refreshTick});
  final int refreshTick;

  @override
  State<OtaScreen> createState() => _OtaScreenState();
}

class _OtaScreenState extends State<OtaScreen> {
  final _api = ApiClient.instance;
  List<dynamic> _releases = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant OtaScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.refreshTick != oldWidget.refreshTick) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _api.getOtaReleases();
      if (!mounted) return;
      setState(() {
        _releases = data;
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
    if (_loading && _releases.isEmpty) return tabLoading();
    if (_error != null && _releases.isEmpty) return tabError(_error!, onRetry: _load);

    return RefreshIndicator(
      onRefresh: _load,
      color: NW.brand,
      backgroundColor: NW.surface,
      child: _releases.isEmpty
          ? tabEmpty('No OTA releases')
          : ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: _releases.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _releaseTile(_releases[i] as Map<String, dynamic>),
            ),
    );
  }

  Widget _releaseTile(Map<String, dynamic> r) {
    final version = r['version']?.toString() ?? '—';
    final module = r['module_type']?.toString();
    final rollout = n(r['rollout_pct']);
    final paused = r['paused'] == true;
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
              Text('v$version', style: const TextStyle(fontWeight: FontWeight.w800, color: NW.text, fontSize: 16)),
              const Spacer(),
              StatusChip(paused ? 'PAUSED' : 'ACTIVE', color: paused ? NW.warn : NW.ok),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '${module ?? 'All modules'} · ${rollout.toInt()}% rollout',
            style: const TextStyle(fontSize: 12, color: NW.text2),
          ),
          const SizedBox(height: 4),
          Text('Created ${timeSince(r['created_at'])}', style: const TextStyle(fontSize: 11, color: NW.text3)),
        ],
      ),
    );
  }
}
