import 'package:flutter/material.dart';

/// Nexwear brand palette (dark) — mirrors the web console.
class NW {
  static const brand = Color(0xFF3B82F6);
  static const brandDim = Color(0xFF2563EB);
  static const factory = Color(0xFF22D3EE);

  static const bg = Color(0xFF09090B);
  static const surface = Color(0xFF111114);
  static const surface1 = Color(0xFF18181C);
  static const surface2 = Color(0xFF222228);
  static const border = Color(0xFF2E2E36);
  static const borderDim = Color(0xFF1E1E24);

  static const text = Color(0xFFF4F4F5);
  static const text2 = Color(0xFFA1A1AA);
  static const text3 = Color(0xFF6B7280);

  static const ok = Color(0xFF22C55E);
  static const warn = Color(0xFFF59E0B);
  static const danger = Color(0xFFEF4444);

  static ThemeData theme() {
    return ThemeData(
      useMaterial3: true,
      scaffoldBackgroundColor: bg,
      colorScheme: const ColorScheme.dark(
        primary: brand,
        surface: surface,
        onSurface: text,
        error: danger,
      ),
      fontFamily: 'Segoe UI',
      appBarTheme: const AppBarTheme(
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
      ),
      cardTheme: const CardThemeData(color: surface, elevation: 0),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface1,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: brand),
        ),
        labelStyle: const TextStyle(color: text3),
        hintStyle: const TextStyle(color: text3),
      ),
    );
  }
}

/// Returns a yield colour: green ≥95, amber ≥80, else red.
Color yieldColor(num? pct) {
  if (pct == null) return NW.text3;
  if (pct >= 95) return NW.ok;
  if (pct >= 80) return NW.warn;
  return NW.danger;
}
