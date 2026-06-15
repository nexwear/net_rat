import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// Thin client for the Nexwear backend (Express API behind nginx at `/api`).
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const _kBase = 'nw_base_url';
  static const _kToken = 'nw_token';
  static const _kUser = 'nw_user';

  String baseUrl = 'http://15.206.16.137';
  String? token;
  Map<String, dynamic>? user;

  Future<void> load() async {
    final p = await SharedPreferences.getInstance();
    baseUrl = p.getString(_kBase) ?? baseUrl;
    token = p.getString(_kToken);
    final u = p.getString(_kUser);
    if (u != null) user = jsonDecode(u) as Map<String, dynamic>;
  }

  Future<void> _persist() async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kBase, baseUrl);
    if (token != null) await p.setString(_kToken, token!);
    if (user != null) await p.setString(_kUser, jsonEncode(user));
  }

  Future<void> logout() async {
    token = null;
    user = null;
    final p = await SharedPreferences.getInstance();
    await p.remove(_kToken);
    await p.remove(_kUser);
  }

  bool get isLoggedIn => token != null;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Uri _u(String path) => Uri.parse('$baseUrl/api$path');

  Future<void> login(String email, String password, {String? base}) async {
    if (base != null && base.trim().isNotEmpty) {
      baseUrl = base.trim().replaceAll(RegExp(r'/+$'), '');
    }
    final r = await http
        .post(_u('/v1/auth/login'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email, 'password': password}))
        .timeout(const Duration(seconds: 15));
    final data = _decode(r);
    if (r.statusCode != 200) {
      throw ApiException(data['error']?.toString() ?? 'Login failed (${r.statusCode})');
    }
    token = data['token'] as String?;
    user = (data['user'] as Map?)?.cast<String, dynamic>();
    await _persist();
  }

  Future<Map<String, dynamic>> getStats() async {
    final r = await http.get(_u('/v1/admin/dashboard/stats'), headers: _headers)
        .timeout(const Duration(seconds: 15));
    return _decode(r);
  }

  Future<List<dynamic>> getDashboard() async {
    final r = await http.get(_u('/v1/admin/dashboard'), headers: _headers)
        .timeout(const Duration(seconds: 15));
    final data = _decode(r);
    return data is List ? data : (data['error'] != null ? throw ApiException(data['error'].toString()) : []);
  }

  Future<List<dynamic>> getAlerts({bool resolved = false}) async {
    final r = await http.get(_u('/v1/admin/alerts?resolved=$resolved'), headers: _headers)
        .timeout(const Duration(seconds: 15));
    final data = jsonDecode(r.body);
    if (r.statusCode != 200) throw ApiException('alerts ${r.statusCode}');
    return data is List ? data : [];
  }

  Future<List<dynamic>> getNodes() async {
    final r = await http.get(_u('/v1/admin/nodes'), headers: _headers).timeout(const Duration(seconds: 15));
    final data = _decodeList(r);
    return data;
  }

  Future<List<dynamic>> getBundles() async {
    final r = await http.get(_u('/v1/admin/bundles'), headers: _headers).timeout(const Duration(seconds: 15));
    return _decodeList(r);
  }

  Future<List<dynamic>> getCards() async {
    final r = await http.get(_u('/v1/admin/cards'), headers: _headers).timeout(const Duration(seconds: 15));
    return _decodeList(r);
  }

  Future<List<dynamic>> getOtaReleases() async {
    final r = await http.get(_u('/v1/admin/ota/releases'), headers: _headers).timeout(const Duration(seconds: 15));
    return _decodeList(r);
  }

  Future<List<dynamic>> getUsers() async {
    final r = await http.get(_u('/v1/auth/users'), headers: _headers).timeout(const Duration(seconds: 15));
    return _decodeList(r);
  }

  Future<void> ackAlert(String id) async {
    final r = await http.post(_u('/v1/admin/alerts/$id/ack'), headers: _headers).timeout(const Duration(seconds: 15));
    if (r.statusCode != 200) {
      final data = _decode(r);
      throw ApiException(data['error']?.toString() ?? 'ack failed (${r.statusCode})');
    }
  }

  // ── Push notification device tokens ──────────────────────────────
  Future<void> registerDevice(String token, String platform) async {
    final r = await http
        .post(_u('/v1/notifications/register'),
            headers: _headers, body: jsonEncode({'token': token, 'platform': platform}))
        .timeout(const Duration(seconds: 10));
    if (r.statusCode != 200) throw ApiException('register device failed (${r.statusCode})');
  }

  Future<void> unregisterDevice(String token) async {
    await http
        .post(_u('/v1/notifications/unregister'),
            headers: _headers, body: jsonEncode({'token': token}))
        .timeout(const Duration(seconds: 10));
  }

  List<dynamic> _decodeList(http.Response r) {
    final data = _decode(r);
    if (r.statusCode != 200) {
      throw ApiException(data is Map ? (data['error']?.toString() ?? 'Request failed (${r.statusCode})') : 'Request failed (${r.statusCode})');
    }
    return data is List ? data : [];
  }

  WebSocketChannel connectWs() {
    final wsBase = baseUrl.replaceFirst(RegExp(r'^http'), 'ws');
    return WebSocketChannel.connect(Uri.parse('$wsBase/api/ws'));
  }

  dynamic _decode(http.Response r) {
    try {
      return jsonDecode(r.body);
    } catch (_) {
      if (r.statusCode == 401) throw ApiException('Session expired — please sign in again.');
      throw ApiException('Bad response (${r.statusCode})');
    }
  }
}

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

/// Safe numeric parse for the dynamic JSON the API returns (numbers sometimes
/// arrive as strings from postgres bigints).
num n(dynamic v) {
  if (v == null) return 0;
  if (v is num) return v;
  return num.tryParse(v.toString()) ?? 0;
}

int? pct(dynamic a, dynamic b) {
  final bb = n(b);
  if (bb <= 0) return null;
  return ((n(a) / bb) * 100).round();
}
