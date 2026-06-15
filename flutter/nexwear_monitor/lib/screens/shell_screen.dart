import 'package:flutter/material.dart';

import '../api.dart';
import '../nav/admin_nav.dart';
import '../push_service.dart';
import '../theme.dart';
import 'alerts_screen.dart';
import 'bundles_screen.dart';
import 'cards_screen.dart';
import 'dashboard_screen.dart';
import 'login_screen.dart';
import 'nodes_screen.dart';
import 'ota_screen.dart';
import 'users_screen.dart';

class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});

  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  final _api = ApiClient.instance;
  late List<AdminTab> _tabs;
  late String _activeKey;
  int _refreshTick = 0;

  @override
  void initState() {
    super.initState();
    _tabs = tabsForUser(_api.user);
    _activeKey = defaultTabForUser(_api.user).key;
  }

  AdminTab get _current => _tabs.firstWhere((t) => t.key == _activeKey, orElse: () => _tabs.first);

  void _selectTab(String key) {
    setState(() => _activeKey = key);
    Navigator.of(context).pop(); // close drawer
  }

  void _refresh() => setState(() => _refreshTick++);

  Future<void> _logout() async {
    await PushService.instance.onLogout(); // stop pushes to this device
    await _api.logout();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  Widget _body() {
    switch (_activeKey) {
      case 'nodes':
        return NodesScreen(refreshTick: _refreshTick);
      case 'bundles':
        return BundlesScreen(refreshTick: _refreshTick);
      case 'cards':
        return CardsScreen(refreshTick: _refreshTick);
      case 'ota':
        return OtaScreen(refreshTick: _refreshTick);
      case 'alerts':
        return AlertsScreen(refreshTick: _refreshTick);
      case 'users':
        return UsersScreen(refreshTick: _refreshTick);
      case 'dashboard':
      default:
        return DashboardScreen(refreshTick: _refreshTick);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = _api.user;
    final role = user?['role']?.toString();
    return Scaffold(
      appBar: AppBar(
        title: Text(_current.label, style: const TextStyle(fontWeight: FontWeight.w700, color: NW.text)),
        actions: [
          IconButton(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh, color: NW.text2),
            tooltip: 'Refresh',
          ),
          IconButton(
            onPressed: _logout,
            icon: const Icon(Icons.logout, color: NW.text2),
            tooltip: 'Sign out',
          ),
          const SizedBox(width: 4),
        ],
      ),
      drawer: Drawer(
        backgroundColor: NW.surface,
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              DrawerHeader(
                margin: EdgeInsets.zero,
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
                decoration: const BoxDecoration(color: NW.surface1),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Text('Nex', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: NW.text)),
                        Text('wear', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: NW.brand)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text('Monitor', style: TextStyle(fontSize: 12, color: NW.text3.withValues(alpha: 0.9))),
                    const Spacer(),
                    if (user != null) ...[
                      Text(
                        user['name']?.toString() ?? user['email']?.toString() ?? 'User',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: NW.text),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        roleLabels[role] ?? role ?? '',
                        style: const TextStyle(fontSize: 11, color: NW.text3),
                      ),
                    ],
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  children: [
                    for (final tab in _tabs)
                      ListTile(
                        leading: Icon(tab.icon, color: _activeKey == tab.key ? NW.brand : NW.text2, size: 22),
                        title: Text(
                          tab.label,
                          style: TextStyle(
                            color: _activeKey == tab.key ? NW.text : NW.text2,
                            fontWeight: _activeKey == tab.key ? FontWeight.w700 : FontWeight.w500,
                          ),
                        ),
                        selected: _activeKey == tab.key,
                        selectedTileColor: NW.brand.withValues(alpha: 0.12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        onTap: () => _selectTab(tab.key),
                      ),
                  ],
                ),
              ),
              const Divider(height: 1, color: NW.border),
              ListTile(
                leading: const Icon(Icons.logout, color: NW.text3, size: 22),
                title: const Text('Sign out', style: TextStyle(color: NW.text2)),
                onTap: _logout,
              ),
            ],
          ),
        ),
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
            decoration: const BoxDecoration(
              color: NW.surface1,
              border: Border(bottom: BorderSide(color: NW.border)),
            ),
            child: Text(
              _current.help,
              style: const TextStyle(fontSize: 12, color: NW.text3, height: 1.35),
            ),
          ),
          Expanded(child: _body()),
        ],
      ),
    );
  }
}
