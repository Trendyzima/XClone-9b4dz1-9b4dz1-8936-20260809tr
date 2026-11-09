import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../http/appwrite_http_client.dart';

class AppwriteAdminException implements Exception {
  const AppwriteAdminException(this.message, {this.code = 'APPWRITE_REQUEST_FAILED', this.status = 0});

  final String message;
  final String code;
  final int status;

  @override
  String toString() => message;
}

/// Short-lived Appwrite session used only by the privileged ad-review screen.
/// The Appwrite cookie is kept in secure storage on native platforms and in
/// the browser's HttpOnly cookie jar on web. Backend JWTs stay in memory only.
class AppwriteAdminSession {
  AppwriteAdminSession({
    http.Client? appwriteClient,
    http.Client? apiClient,
    FlutterSecureStorage? storage,
  })  : _appwriteClient = appwriteClient ?? createAppwriteHttpClient(),
        _apiClient = apiClient ?? http.Client(),
        _storage = storage ?? const FlutterSecureStorage();

  static const _cookieStorageKey = 'testagram.appwrite.admin.session.cookie';
  final http.Client _appwriteClient;
  final http.Client _apiClient;
  final FlutterSecureStorage _storage;

  String? _sessionCookie;
  String? _jwt;

  bool get isAuthenticated => _jwt != null && _jwt!.isNotEmpty;

  Uri _appwriteUri(String path) {
    if (!AppConfig.isAppwriteConfigured) {
      throw const AppwriteAdminException(
        'APPWRITE_ENDPOINT and APPWRITE_PROJECT_ID must be configured.',
        code: 'APPWRITE_CONFIG_REQUIRED',
        status: 503,
      );
    }
    return Uri.parse('${AppConfig.appwriteEndpoint.replaceFirst(RegExp(r'/+$'), '')}$path');
  }

  Uri _apiUri(String path) {
    if (!AppConfig.isTestagramApiConfigured) {
      throw const AppwriteAdminException(
        'TESTAGRAM_API_URL must be configured.',
        code: 'API_CONFIG_REQUIRED',
        status: 503,
      );
    }
    return Uri.parse(AppConfig.testagramApiUrl).resolve(path);
  }

  Future<void> restore() async {
    if (!kIsWeb) {
      _sessionCookie = await _storage.read(key: _cookieStorageKey);
    }
    if (_sessionCookie != null || kIsWeb) {
      await _refreshJwt();
    }
  }

  Future<void> signIn({required String email, required String password}) async {
    final normalizedEmail = email.trim().toLowerCase();
    if (!RegExp(r'^\S+@\S+\.\S+$').hasMatch(normalizedEmail) || password.isEmpty) {
      throw const AppwriteAdminException('Enter a valid Appwrite email and password.', code: 'INVALID_CREDENTIALS');
    }
    final response = await _appwriteRequest(
      '/account/sessions/email',
      method: 'POST',
      body: {'email': normalizedEmail, 'password': password},
    );
    _captureSessionCookie(response);
    await _refreshJwt();
  }

  Future<Map<String, dynamic>> listMfaFactors() async {
    final payload = await _appwriteRequest('/account/mfa/factors');
    return payload;
  }

  Future<String> createMfaChallenge(String factorId) async {
    if (!const {'totp', 'email', 'phone', 'recoverycode'}.contains(factorId)) {
      throw const AppwriteAdminException('Unsupported MFA factor.', code: 'INVALID_MFA_FACTOR');
    }
    final response = await _appwriteRequest(
      '/account/mfa/challenges',
      method: 'POST',
      body: {'factorId': factorId},
    );
    final challengeId = '${response['$id'] ?? response['id'] ?? ''}';
    if (challengeId.isEmpty) {
      throw const AppwriteAdminException('Appwrite did not return an MFA challenge ID.');
    }
    return challengeId;
  }

  Future<void> completeMfaChallenge({required String challengeId, required String otp}) async {
    final code = otp.trim();
    if (challengeId.trim().isEmpty || !RegExp(r'^\d{6,10}$').hasMatch(code)) {
      throw const AppwriteAdminException('Enter the verification code from your second factor.', code: 'INVALID_MFA_CODE');
    }
    final response = await _appwriteRequest(
      '/account/mfa/challenges',
      method: 'PUT',
      body: {'challengeId': challengeId, 'otp': code},
    );
    _captureSessionCookie(response);
    await _refreshJwt();
  }

  Future<List<Map<String, dynamic>>> getAdReviewQueue({String status = 'pending', int limit = 100}) async {
    final query = Uri(queryParameters: {'status': status, 'limit': '$limit'}).query;
    final result = await _backendRequest('/api/admin/ads/review-queue?$query');
    final items = result['items'];
    if (items is! List) return const [];
    return items.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList();
  }

  Future<Map<String, dynamic>> reviewCampaign({
    required String campaignId,
    required String decision,
    String note = '',
  }) {
    return _backendRequest(
      '/api/admin/ads/${Uri.encodeComponent(campaignId)}/review',
      method: 'POST',
      body: {'decision': decision, 'note': note},
    );
  }

  Future<Map<String, dynamic>> updateCampaignStatus({
    required String campaignId,
    required String status,
  }) {
    return _backendRequest(
      '/api/admin/ads/${Uri.encodeComponent(campaignId)}/status',
      method: 'POST',
      body: {'status': status},
    );
  }

  Future<void> signOut() async {
    try {
      await _appwriteRequest('/account/sessions/current', method: 'DELETE');
    } finally {
      _jwt = null;
      _sessionCookie = null;
      if (!kIsWeb) {
        await _storage.delete(key: _cookieStorageKey);
      }
    }
  }

  Future<void> _refreshJwt() async {
    final result = await _appwriteRequest('/account/jwt', method: 'POST', body: const {});
    final jwt = '${result['jwt'] ?? ''}';
    if (jwt.isEmpty) {
      throw const AppwriteAdminException('Appwrite did not return a backend JWT.', code: 'JWT_MISSING');
    }
    _jwt = jwt;
  }

  Future<Map<String, dynamic>> _appwriteRequest(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
  }) async {
    final headers = <String, String>{
      'X-Appwrite-Project': AppConfig.appwriteProjectId,
      'Accept': 'application/json',
      if (body != null) 'Content-Type': 'application/json',
      if (!kIsWeb && _sessionCookie != null) 'Cookie': _sessionCookie!,
    };
    final request = http.Request(method, _appwriteUri(path))..headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);
    final streamed = await _appwriteClient.send(request).timeout(const Duration(seconds: 15));
    final response = await http.Response.fromStream(streamed);
    await _captureSessionCookie(response);
    return _decodeResponse(response);
  }

  Future<Map<String, dynamic>> _backendRequest(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
  }) async {
    final token = _jwt;
    if (token == null || token.isEmpty) {
      throw const AppwriteAdminException('Sign in to Appwrite before reviewing ads.', code: 'AUTH_REQUIRED', status: 401);
    }
    final request = http.Request(method, _apiUri(path))
      ..headers.addAll({
        'Authorization': 'Bearer $token',
        'Accept': 'application/json',
        'X-Testagram-API-Version': '1',
        'X-Request-ID': 'flutter-admin-${DateTime.now().microsecondsSinceEpoch}',
        if (body != null) 'Content-Type': 'application/json',
      });
    if (body != null) request.body = jsonEncode(body);
    final streamed = await _apiClient.send(request).timeout(const Duration(seconds: 20));
    final response = await http.Response.fromStream(streamed);
    return _decodeResponse(response, unwrapEnvelope: true);
  }

  Map<String, dynamic> _decodeResponse(http.Response response, {bool unwrapEnvelope = false}) {
    Map<String, dynamic> payload;
    try {
      final decoded = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
      payload = decoded is Map ? Map<String, dynamic>.from(decoded) : <String, dynamic>{};
    } catch (_) {
      throw AppwriteAdminException(
        'The service returned an unreadable response (HTTP ${response.statusCode}).',
        status: response.statusCode,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final nested = payload['error'];
      final errorMap = nested is Map ? Map<String, dynamic>.from(nested) : <String, dynamic>{};
      final code = '${errorMap['code'] ?? payload['code'] ?? payload['type'] ?? 'REQUEST_FAILED'}';
      final message = '${errorMap['message'] ?? payload['message'] ?? nested ?? 'Request failed.'}';
      throw AppwriteAdminException(message, code: code, status: response.statusCode);
    }
    if (!unwrapEnvelope) return payload;
    if (payload['ok'] == false) {
      final nested = payload['error'];
      final errorMap = nested is Map ? Map<String, dynamic>.from(nested) : <String, dynamic>{};
      throw AppwriteAdminException(
        '${errorMap['message'] ?? nested ?? 'Backend request failed.'}',
        code: '${errorMap['code'] ?? payload['code'] ?? 'API_REQUEST_FAILED'}',
        status: response.statusCode,
      );
    }
    final data = payload['data'];
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  Future<void> _captureSessionCookie(http.Response response) async {
    if (kIsWeb) return;
    final raw = response.headers['set-cookie'];
    if (raw == null || raw.isEmpty) return;
    final cookieName = 'a_session_${AppConfig.appwriteProjectId}=';
    for (final part in raw.split(',')) {
      final candidate = part.trim();
      final start = candidate.indexOf(cookieName);
      if (start < 0) continue;
      final value = candidate.substring(start).split(';').first.trim();
      if (value.startsWith(cookieName) && value.length > cookieName.length) {
        _sessionCookie = value;
        await _storage.write(key: _cookieStorageKey, value: value);
        return;
      }
    }
  }

  void dispose() {
    _appwriteClient.close();
    _apiClient.close();
  }
}
