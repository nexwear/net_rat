import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key, this.refreshTick = 0});
  final int refreshTick;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _api = ApiClient.instance;
  Map<String, dynamic>? _stats;
  List<dynamic> _alerts = [];
  String? _error;
  bool _loading = true;
  DateTime? _updated;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _refresh();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) => _refresh(silent: true));
  }

  @override
  void didUpdateWidget(covariant DashboardScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.refreshTick != oldWidget.refreshTick) _refresh(silent: true);
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _refresh({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final results = await Future.wait([_api.getStats(), _api.getAlerts()]);
      if (!mounted) return;
      setState(() {
        _stats = results[0] as Map<String, dynamic>;
        _alerts = results[1] as List<dynamic>;
        _error = null;
        _updated = DateTime.now();
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

  bool _isNarrow(BuildContext context) => MediaQuery.sizeOf(context).width < 420;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _refresh,
      backgroundColor: NW.surface,
      color: NW.brand,
      child: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading && _stats == null) {
      return const Center(child: CircularProgressIndicator(color: NW.brand));
    }
    if (_error != null && _stats == null) {
      return _errorView();
    }
    final s = _stats!;
    final b = (s['bundles'] ?? {}) as Map<String, dynamic>;
    final sess = (s['sessions'] ?? {}) as Map<String, dynamic>;
    final nodes = (s['nodes'] ?? {}) as Map<String, dynamic>;
    final lines = (s['lines'] ?? []) as List<dynamic>;
    final contractors = (s['contractors'] ?? []) as List<dynamic>;

    final inToday = n(sess['input_today']);
    final outToday = n(sess['output_today']);
    final yld = pct(outToday, inToday);

    final w = MediaQuery.sizeOf(context).width;
    final compact = w < 420;
    final pad = compact ? 12.0 : 16.0;

    return ListView(
      padding: EdgeInsets.fromLTRB(pad, pad, pad, 24),
      children: [
        if (_updated != null) _updatedBanner(compact),
        if (_error != null) _inlineError(),
        // KPI grid
        GridView.count(
          crossAxisCount: w > 640 ? 4 : 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: compact ? 8 : 12,
          mainAxisSpacing: compact ? 8 : 12,
          childAspectRatio: compact ? 1.35 : 1.55,
          children: [
            _kpi('Active Bundles', n(b['in_progress']).toString(), '${n(b['issued'])} waiting', NW.warn),
            _kpi('Completed Today', n(b['completed_today']).toString(), '${n(b['completed'])} all-time', NW.ok),
            _kpi('Input Today', _compact(inToday), 'pieces in', NW.brand),
            _kpi('Today\'s Yield', yld != null ? '$yld%' : '—', '${_compact(outToday)} out', yieldColor(yld?.toDouble())),
          ],
        ),
        SizedBox(height: compact ? 12 : 16),
        // Summary panels
        if (w > 700)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _panel('Bundle Status', _bundleRows(b))),
              const SizedBox(width: 12),
              Expanded(child: _panel('Node Health', _nodeRows(nodes))),
            ],
          )
        else ...[
          _panel('Bundle Status', _bundleRows(b)),
          _panel('Node Health', _nodeRows(nodes)),
        ],
        _alertsPanel(),
        const SizedBox(height: 4),
        if (lines.isNotEmpty) _sectionTitle('Line Performance'),
        ...lines.map((l) => _lineCard(l as Map<String, dynamic>)),
        if (contractors.isNotEmpty) ...[
          const SizedBox(height: 8),
          _sectionTitle('Contractor Output'),
          ...contractors.map((c) => _contractorCard(c as Map<String, dynamic>)),
        ],
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _updatedBanner(bool compact) {
    return Padding(
      padding: EdgeInsets.only(bottom: compact ? 8 : 12),
      child: Row(
        children: [
          const Icon(Icons.schedule, size: 14, color: NW.text3),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              _fmtTime(_updated!),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: NW.text3),
            ),
          ),
          if (_loading)
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2, color: NW.brand),
            ),
        ],
      ),
    );
  }

  List<Widget> _bundleRows(Map<String, dynamic> b) => [
        _statRow('In Progress', n(b['in_progress']), NW.warn),
        _statRow('Issued (waiting)', n(b['issued']), NW.text3),
        _statRow('Completed', n(b['completed']), NW.ok),
        _statRow('Lost', n(b['lost']), NW.danger),
      ];

  List<Widget> _nodeRows(Map<String, dynamic> nodes) => [
        _statRow('Online', n(nodes['active']), NW.ok),
        _statRow('Stale', n(nodes['stale']), NW.warn),
        _statRow('Offline', n(nodes['offline']), NW.danger),
        _statRow('Pending Approval', n(nodes['pending']), NW.brand),
      ];

  // ── KPI ───────────────────────────────────────────────────────────
  Widget _kpi(String title, String value, String sub, Color accent) {
    final compact = _isNarrow(context);
    return Container(
      padding: EdgeInsets.all(compact ? 12 : 16),
      decoration: BoxDecoration(
        color: NW.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: NW.border),
        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 4, offset: Offset(0, 1))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(children: [
            Container(width: 3, height: 14, color: accent),
            const SizedBox(width: 6),
            Expanded(
              child: Text(title.toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: NW.text3, letterSpacing: 0.5)),
            ),
          ]),
          Text(value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  fontSize: compact ? 22 : 26, fontWeight: FontWeight.w800, color: accent, letterSpacing: -1)),
          Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: NW.text3)),
        ],
      ),
    );
  }

  // ── Summary panel ────────────────────────────────────────────────
  Widget _panel(String title, List<Widget> rows) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
      decoration: BoxDecoration(
        color: NW.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: NW.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title.toUpperCase(),
              style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: NW.text3, letterSpacing: 1)),
          const SizedBox(height: 6),
          ...rows,
        ],
      ),
    );
  }

  Widget _statRow(String label, num value, Color dot) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Container(width: 7, height: 7, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
          const SizedBox(width: 8),
          Expanded(child: Text(label, style: const TextStyle(fontSize: 13, color: NW.text2))),
          Text(value.toString(),
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: value > 0 ? NW.text : NW.text3)),
        ],
      ),
    );
  }

  // ── Alerts panel ─────────────────────────────────────────────────
  Widget _alertsPanel() {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
      decoration: BoxDecoration(
        color: NW.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _alerts.isEmpty ? NW.border : NW.danger.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const Text('OPEN ALERTS',
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: NW.text3, letterSpacing: 1)),
            const Spacer(),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: (_alerts.isEmpty ? NW.ok : NW.danger).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(5),
              ),
              child: Text(_alerts.length.toString(),
                  style: TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w700, color: _alerts.isEmpty ? NW.ok : NW.danger)),
            ),
          ]),
          const SizedBox(height: 8),
          if (_alerts.isEmpty)
            const Text('No open alerts', style: TextStyle(fontSize: 13, color: NW.text3))
          else
            ..._alerts.take(6).map((a) => _alertRow(a as Map<String, dynamic>)),
        ],
      ),
    );
  }

  Widget _alertRow(Map<String, dynamic> a) {
    final sev = (a['severity'] ?? '').toString().toUpperCase();
    final color = sev == 'HIGH' ? NW.danger : (sev == 'MED' ? NW.warn : NW.text3);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 5, right: 8),
            child: Container(width: 7, height: 7, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(a['type']?.toString() ?? 'ALERT',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: NW.text)),
                if (a['detail'] != null)
                  Text(a['detail'].toString(),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11, color: NW.text3)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Line + contractor cards ──────────────────────────────────────
  Widget _lineCard(Map<String, dynamic> l) {
    final yld = pct(l['output_pieces'], l['input_pieces']);
    return _rowCard(
      title: l['name']?.toString() ?? 'Line',
      trailing: '${n(l['active_nodes'])}/${n(l['total_nodes'])} nodes',
      chips: [
        _chip('${n(l['active_bundles'])} active', NW.warn),
        _chip('${n(l['completed_bundles'])} done', NW.ok),
      ],
      metrics: [
        _metric('In', _compact(n(l['input_pieces']))),
        _metric('Out', _compact(n(l['output_pieces']))),
        _metric('Yield', yld != null ? '$yld%' : '—', color: yieldColor(yld?.toDouble())),
      ],
      yld: yld,
    );
  }

  Widget _contractorCard(Map<String, dynamic> c) {
    final yld = pct(c['output_pieces'], c['input_pieces']);
    final code = c['code']?.toString();
    return _rowCard(
      title: c['contractor_name']?.toString() ?? 'Contractor',
      trailing: code != null && code.isNotEmpty ? code : null,
      chips: [
        _chip('${n(c['bundles_active'])} active', NW.warn),
        _chip('${n(c['bundles_completed'])} done', NW.ok),
        _chip('${n(c['bundles_assigned'])} total', NW.text3),
      ],
      metrics: [
        _metric('Declared', _compact(n(c['declared_pieces']))),
        _metric('In', _compact(n(c['input_pieces']))),
        _metric('Out', _compact(n(c['output_pieces']))),
        _metric('Yield', yld != null ? '$yld%' : '—', color: yieldColor(yld?.toDouble())),
      ],
      yld: yld,
    );
  }

  Widget _rowCard({
    required String title,
    String? trailing,
    required List<Widget> chips,
    required List<Widget> metrics,
    int? yld,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
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
                child: Text(title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: NW.text)),
              ),
              if (trailing != null) ...[
                const SizedBox(width: 8),
                Flexible(
                  child: Text(trailing,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.end,
                      style: const TextStyle(fontSize: 11, color: NW.text3)),
                ),
              ],
            ],
          ),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: chips),
          const SizedBox(height: 12),
          Wrap(spacing: 20, runSpacing: 12, children: metrics),
          if (yld != null) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: (yld.clamp(0, 100)) / 100,
                minHeight: 5,
                backgroundColor: NW.surface2,
                valueColor: AlwaysStoppedAnimation(yieldColor(yld.toDouble())),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _metric(String label, String value, {Color? color}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label.toUpperCase(), style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w600, color: NW.text3, letterSpacing: 0.5)),
        const SizedBox(height: 2),
        Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: color ?? NW.text)),
      ],
    );
  }

  Widget _chip(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color)),
    );
  }

  Widget _sectionTitle(String t) => Padding(
        padding: const EdgeInsets.only(top: 4, bottom: 10),
        child: Text(t.toUpperCase(),
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: NW.text3, letterSpacing: 1)),
      );

  // ── error states ──────────────────────────────────────────────────
  Widget _errorView() {
    return ListView(
      children: [
        const SizedBox(height: 120),
        const Icon(Icons.cloud_off, size: 40, color: NW.text3),
        const SizedBox(height: 12),
        Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Text(_error ?? 'Failed to load', textAlign: TextAlign.center, style: const TextStyle(color: NW.text3)),
          ),
        ),
        const SizedBox(height: 16),
        Center(
          child: FilledButton(
            onPressed: () => _refresh(),
            style: FilledButton.styleFrom(backgroundColor: NW.brand),
            child: const Text('Retry'),
          ),
        ),
      ],
    );
  }

  Widget _inlineError() => Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: NW.danger.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: NW.danger.withValues(alpha: 0.3)),
        ),
        child: Text('Last refresh failed: $_error', style: const TextStyle(fontSize: 12, color: NW.danger)),
      );

  // ── formatting ────────────────────────────────────────────────────
  String _compact(num v) {
    if (v >= 1000000) return '${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 10000) return '${(v / 1000).toStringAsFixed(1)}k';
    return v.toString();
  }

  String _fmtTime(DateTime t) {
    String two(int x) => x.toString().padLeft(2, '0');
    return 'updated ${two(t.hour)}:${two(t.minute)}:${two(t.second)}';
  }
}
