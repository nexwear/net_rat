import 'package:flutter/material.dart';

import '../theme.dart';

class StatusChip extends StatelessWidget {
  const StatusChip(this.label, {super.key, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: color, letterSpacing: 0.3),
      ),
    );
  }
}

Color statusColor(String? status) {
  switch (status?.toUpperCase()) {
    case 'ACTIVE':
    case 'COMPLETED':
    case 'AVAILABLE':
      return NW.ok;
    case 'PENDING':
    case 'IN_PROGRESS':
    case 'IN_USE':
    case 'MED':
      return NW.warn;
    case 'OFFLINE':
    case 'LOST':
    case 'HIGH':
    case 'DECOMMISSIONED':
      return NW.danger;
    default:
      return NW.text3;
  }
}

String timeSince(dynamic ts) {
  if (ts == null) return '—';
  final dt = DateTime.tryParse(ts.toString());
  if (dt == null) return '—';
  final sec = DateTime.now().difference(dt).inSeconds;
  if (sec < 60) return '${sec}s ago';
  if (sec < 3600) return '${sec ~/ 60}m ago';
  if (sec < 86400) return '${sec ~/ 3600}h ago';
  return '${sec ~/ 86400}d ago';
}

Widget tabLoading() => const Center(child: CircularProgressIndicator(color: NW.brand));

Widget tabError(String message, {VoidCallback? onRetry}) {
  return ListView(
    children: [
      const SizedBox(height: 80),
      const Icon(Icons.cloud_off, size: 36, color: NW.text3),
      const SizedBox(height: 12),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 28),
        child: Text(message, textAlign: TextAlign.center, style: const TextStyle(color: NW.text3, fontSize: 13)),
      ),
      if (onRetry != null) ...[
        const SizedBox(height: 16),
        Center(
          child: FilledButton(
            onPressed: onRetry,
            style: FilledButton.styleFrom(backgroundColor: NW.brand),
            child: const Text('Retry'),
          ),
        ),
      ],
    ],
  );
}

Widget tabEmpty(String message) {
  return ListView(
    children: [
      const SizedBox(height: 80),
      const Icon(Icons.inbox_outlined, size: 36, color: NW.text3),
      const SizedBox(height: 12),
      Center(child: Text(message, style: const TextStyle(color: NW.text3, fontSize: 13))),
    ],
  );
}
