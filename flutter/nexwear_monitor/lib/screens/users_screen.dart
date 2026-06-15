import 'package:flutter/material.dart';

import '../api.dart';
import '../nav/admin_nav.dart';
import '../theme.dart';
import '../widgets/tab_helpers.dart';

class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key, required this.refreshTick});
  final int refreshTick;

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  final _api = ApiClient.instance;
  List<dynamic> _users = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant UsersScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.refreshTick != oldWidget.refreshTick) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _api.getUsers();
      if (!mounted) return;
      setState(() {
        _users = data;
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
    if (_loading && _users.isEmpty) return tabLoading();
    if (_error != null && _users.isEmpty) return tabError(_error!, onRetry: _load);

    return RefreshIndicator(
      onRefresh: _load,
      color: NW.brand,
      backgroundColor: NW.surface,
      child: _users.isEmpty
          ? tabEmpty('No users')
          : ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: _users.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _userTile(_users[i] as Map<String, dynamic>),
            ),
    );
  }

  Widget _userTile(Map<String, dynamic> u) {
    final role = u['role']?.toString() ?? '';
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: NW.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: NW.border),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: NW.brand.withValues(alpha: 0.15),
            child: Text(
              (u['name']?.toString() ?? u['email']?.toString() ?? '?').substring(0, 1).toUpperCase(),
              style: const TextStyle(color: NW.brand, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  u['name']?.toString() ?? u['email']?.toString() ?? '—',
                  style: const TextStyle(fontWeight: FontWeight.w600, color: NW.text),
                ),
                Text(u['email']?.toString() ?? '', style: const TextStyle(fontSize: 11, color: NW.text3)),
              ],
            ),
          ),
          StatusChip(roleLabels[role] ?? role, color: NW.brand),
        ],
      ),
    );
  }
}
