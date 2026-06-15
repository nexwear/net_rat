import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import '../widgets/tab_helpers.dart';

class CardsScreen extends StatefulWidget {
  const CardsScreen({super.key, required this.refreshTick});
  final int refreshTick;

  @override
  State<CardsScreen> createState() => _CardsScreenState();
}

class _CardsScreenState extends State<CardsScreen> {
  final _api = ApiClient.instance;
  List<dynamic> _cards = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant CardsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.refreshTick != oldWidget.refreshTick) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _api.getCards();
      if (!mounted) return;
      setState(() {
        _cards = data;
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

  String _cardNum(dynamic v) {
    if (v == null) return '—';
    final n = int.tryParse(v.toString());
    return n != null ? n.toString().padLeft(3, '0') : v.toString();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _cards.isEmpty) return tabLoading();
    if (_error != null && _cards.isEmpty) return tabError(_error!, onRetry: _load);

    return RefreshIndicator(
      onRefresh: _load,
      color: NW.brand,
      backgroundColor: NW.surface,
      child: _cards.isEmpty
          ? tabEmpty('No cards registered')
          : ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: _cards.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _cardTile(_cards[i] as Map<String, dynamic>),
            ),
    );
  }

  Widget _cardTile(Map<String, dynamic> c) {
    final status = c['status']?.toString() ?? '—';
    final uid = c['uid']?.toString() ?? '—';
    final num = _cardNum(c['card_number']);
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
              Text('#$num', style: const TextStyle(fontWeight: FontWeight.w800, color: NW.text, fontSize: 16)),
              const SizedBox(width: 10),
              Expanded(
                child: Text(uid, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: NW.text2)),
              ),
              StatusChip(status, color: statusColor(status)),
            ],
          ),
          if (c['label'] != null && c['label'].toString().isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(c['label'].toString(), style: const TextStyle(fontSize: 11, color: NW.text3)),
            ),
          if (c['line_name'] != null || c['bundle_status'] != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                [c['line_name'], c['bundle_status']].where((e) => e != null && e.toString().isNotEmpty).join(' · '),
                style: const TextStyle(fontSize: 11, color: NW.text3),
              ),
            ),
        ],
      ),
    );
  }
}
