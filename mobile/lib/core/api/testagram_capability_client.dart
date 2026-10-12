import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';

/// A small, shared client for the existing Testagram capability boundary.
///
/// Feature code must use this gateway instead of inventing per-screen RPCs or
/// writing around the canonical authorization boundary. Only explicitly public
/// capabilities may be called without a signed-in session.
class TestagramCapabilityClient {
  TestagramCapabilityClient({
    required this.endpoint,
    required this.publishableKey,
    required this.getAccessToken,
    this.refreshAccessToken,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 15),
  }) : _httpClient = httpClient ?? http.Client();

  factory TestagramCapabilityClient.fromAppConfig({
    SupabaseClient? supabaseClient,
    http.Client? httpClient,
    Duration timeout = const Duration(seconds: 15),
  }) {
    final client = supabaseClient ?? Supabase.instance.client;
    return TestagramCapabilityClient(
      endpoint: Uri.parse(AppConfig.siteUrl).resolve('/api/capability'),
      publishableKey: AppConfig.supabasePublishableKey,
      getAccessToken: () async => client.auth.currentSession?.accessToken,
      refreshAccessToken: () async {
        final refreshed = await client.auth.refreshSession();
        return refreshed.session?.accessToken ??
            client.auth.currentSession?.accessToken;
      },
      httpClient: httpClient,
      timeout: timeout,
    );
  }

  static const publicCapabilities = <String>{
    'testagram.capabilities.list',
    'testagram.health.read',
    'testagram.news.trending',
  };

  final Uri endpoint;
  final String publishableKey;
  final Future<String?> Function() getAccessToken;
  final Future<String?> Function()? refreshAccessToken;
  final Duration timeout;
  final http.Client _httpClient;

  Future<T> call<T>(
    String capability, {
    Map<String, Object?> input = const <String, Object?>{},
  }) async {
    if (capability.trim().isEmpty) {
      throw const TestagramCapabilityException(
        'Capability name is required.',
        code: 'CAPABILITY_REQUIRED',
      );
    }

    final isPublic = publicCapabilities.contains(capability);
    var token = await getAccessToken();
    if ((token == null || token.isEmpty) && !isPublic) {
      throw const TestagramCapabilityException(
        'Sign in to continue.',
        code: 'AUTH_REQUIRED',
        statusCode: 401,
      );
    }

    for (var attempt = 0; attempt < 2; attempt++) {
      late final http.Response response;
      try {
        response = await _httpClient
            .post(
              endpoint,
              headers: <String, String>{
                'apikey': publishableKey,
                'Authorization':
                    'Bearer ${token?.isNotEmpty == true ? token : publishableKey}',
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Client-Info': 'testagram-flutter/1',
              },
              body: jsonEncode(<String, Object?>{
                'capability': capability,
                'input': input,
              }),
            )
            .timeout(timeout);
      } on TimeoutException {
        throw const TestagramCapabilityException(
          'The request timed out. Check your connection and retry.',
          code: 'TIMEOUT',
        );
      } on http.ClientException {
        throw const TestagramCapabilityException(
          'Could not connect to Testagram. Check your connection and retry.',
          code: 'NETWORK_ERROR',
        );
      }

      if ((response.statusCode == 401 || response.statusCode == 403) &&
          !isPublic &&
          attempt == 0 &&
          refreshAccessToken != null) {
        token = await refreshAccessToken!();
        if (token != null && token.isNotEmpty) continue;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        final message = _responseMessage(response);
        throw TestagramCapabilityException(
          message ??
              (response.statusCode == 401 || response.statusCode == 403
                  ? 'Sign in to continue.'
                  : 'Testagram could not complete this request.'),
          code: response.statusCode == 401 || response.statusCode == 403
              ? 'AUTH_REQUIRED'
              : 'CAPABILITY_REQUEST_FAILED',
          statusCode: response.statusCode,
        );
      }

      if (response.body.trim().isEmpty) {
        throw const TestagramCapabilityException(
          'Testagram returned an empty response.',
          code: 'EMPTY_RESPONSE',
        );
      }
      try {
        return jsonDecode(response.body) as T;
      } on FormatException {
        throw const TestagramCapabilityException(
          'Testagram returned an invalid response.',
          code: 'INVALID_RESPONSE',
        );
      } on TypeError {
        throw const TestagramCapabilityException(
          'Testagram returned an unexpected response shape.',
          code: 'INVALID_RESPONSE',
        );
      }
    }

    throw const TestagramCapabilityException(
      'Authentication could not be refreshed. Sign in again.',
      code: 'AUTH_REQUIRED',
      statusCode: 401,
    );
  }

  String? _responseMessage(http.Response response) {
    try {
      final payload = jsonDecode(response.body);
      if (payload is Map<String, dynamic>) {
        final message = payload['message'] ?? payload['error'];
        if (message is String && message.trim().isNotEmpty) {
          return message.trim();
        }
        final nested = payload['error'];
        if (nested is Map<String, dynamic> &&
            nested['message'] is String &&
            (nested['message'] as String).trim().isNotEmpty) {
          return (nested['message'] as String).trim();
        }
      }
    } on FormatException {
      return null;
    }
    return null;
  }

  void close() => _httpClient.close();
}

class TestagramCapabilityException implements Exception {
  const TestagramCapabilityException(
    this.message, {
    required this.code,
    this.statusCode,
  });

  final String message;
  final String code;
  final int? statusCode;

  @override
  String toString() => message;
}
