import 'package:flutter/material.dart';

class AdminTab {
  const AdminTab({
    required this.key,
    required this.label,
    required this.icon,
    required this.help,
  });

  final String key;
  final String label;
  final IconData icon;
  final String help;
}

const rolePerms = <String, List<String>>{
  'SUPER_ADMIN': ['dashboard', 'nodes', 'bundles', 'cards', 'ota', 'alerts', 'users'],
  'FACTORY_ADMIN': ['dashboard', 'nodes', 'bundles', 'cards', 'ota', 'alerts', 'users'],
  'LINE_SUPERVISOR': ['dashboard', 'nodes', 'alerts'],
  'ADMIN_OPERATOR': ['dashboard', 'nodes', 'bundles', 'cards'],
  'AUDITOR': ['dashboard'],
  'CONTRACTOR': ['dashboard'],
};

const allTabs = <AdminTab>[
  AdminTab(
    key: 'dashboard',
    label: 'Dashboard',
    icon: Icons.dashboard_outlined,
    help: 'Live production overview — KPIs, lines, and alerts.',
  ),
  AdminTab(
    key: 'nodes',
    label: 'Nodes',
    icon: Icons.memory_outlined,
    help: 'ESP32 reader nodes — status, firmware, and connectivity.',
  ),
  AdminTab(
    key: 'bundles',
    label: 'Bundles',
    icon: Icons.inventory_2_outlined,
    help: 'Garment batches moving through the production line.',
  ),
  AdminTab(
    key: 'cards',
    label: 'Cards',
    icon: Icons.nfc_outlined,
    help: 'NFC card registry and assignment status.',
  ),
  AdminTab(
    key: 'ota',
    label: 'OTA Updates',
    icon: Icons.system_update_outlined,
    help: 'Firmware releases and rollout status.',
  ),
  AdminTab(
    key: 'alerts',
    label: 'Alerts',
    icon: Icons.notifications_active_outlined,
    help: 'Production floor alerts — acknowledge to dismiss.',
  ),
  AdminTab(
    key: 'users',
    label: 'Users',
    icon: Icons.people_outline,
    help: 'Console accounts and roles.',
  ),
];

const roleLabels = <String, String>{
  'SUPER_ADMIN': 'Super Admin',
  'FACTORY_ADMIN': 'Factory Admin',
  'LINE_SUPERVISOR': 'Line Supervisor',
  'ADMIN_OPERATOR': 'Operator',
  'AUDITOR': 'Auditor',
  'CONTRACTOR': 'Contractor',
};

List<AdminTab> tabsForUser(Map<String, dynamic>? user) {
  final role = user?['role']?.toString() ?? 'AUDITOR';
  final allowed = rolePerms[role] ?? const ['dashboard'];
  return allTabs.where((t) => allowed.contains(t.key)).toList();
}

AdminTab defaultTabForUser(Map<String, dynamic>? user) {
  final tabs = tabsForUser(user);
  return tabs.isEmpty ? allTabs.first : tabs.first;
}
