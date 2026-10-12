import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:testagram/core/api/testagram_capability_client.dart';

void main() {
  final endpoint = Uri.parse('https://testagram.site/api/capability');

  test(
    'rejects private capabilities without a session before network access',
    () async {
      var requests = 0;
      final client = TestagramCapabilityClient(
        endpoint: endpoint,
        publishableKey: 'public-key',
        getAccessToken: () async => null,
        httpClient: MockClient((_) async {
          requests++;
          return http.Response('{}', 200);
        }),
      );

      await expectLater(
        client.call<Map<String, dynamic>>('testagram.messages.list'),
        throwsA(
          isA<TestagramCapabilityException>()
              .having((error) => error.code, 'code', 'AUTH_REQUIRED'),
        ),
      );
      expect(requests, 0);
      client.close();
    },
  );

  test('sends authenticated capability requests with a session JWT', () async {
    late http.Request captured;
    final client = TestagramCapabilityClient(
      endpoint: endpoint,
      publishableKey: 'public-key',
      getAccessToken: () async => 'session-jwt',
      httpClient: MockClient((request) async {
        captured = request;
        return http.Response(jsonEncode({'items': <dynamic>[]}), 200);
      }),
    );

    final result = await client.call<Map<String, dynamic>>(
      'testagram.messages.list',
      input: {'conversation_id': 'conversation-1', 'limit': 20},
    );

    expect(captured.url, endpoint);
    expect(captured.headers['apikey'], 'public-key');
    expect(captured.headers['Authorization'], 'Bearer session-jwt');
    expect(captured.headers['Content-Type'], 'application/json');
    expect(jsonDecode(captured.body), {
      'capability': 'testagram.messages.list',
      'input': {'conversation_id': 'conversation-1', 'limit': 20},
    });
    expect(result['items'], isEmpty);
    client.close();
  });

  test(
    'only allows explicitly public capabilities without a session',
    () async {
      late http.Request captured;
      final client = TestagramCapabilityClient(
        endpoint: endpoint,
        publishableKey: 'public-key',
        getAccessToken: () async => null,
        httpClient: MockClient((request) async {
          captured = request;
          return http.Response(jsonEncode({'services': <dynamic>[]}), 200);
        }),
      );

      final result = await client.call<Map<String, dynamic>>(
        'testagram.health.read',
      );

      expect(captured.headers['Authorization'], 'Bearer public-key');
      expect(result['services'], isEmpty);
      client.close();
    },
  );

  test('refreshes a rejected session once before retrying', () async {
    var requests = 0;
    late String firstAuthorization;
    late String secondAuthorization;
    final client = TestagramCapabilityClient(
      endpoint: endpoint,
      publishableKey: 'public-key',
      getAccessToken: () async => 'expired-jwt',
      refreshAccessToken: () async => 'refreshed-jwt',
      httpClient: MockClient((request) async {
        requests++;
        if (requests == 1) {
          firstAuthorization = request.headers['Authorization']!;
          return http.Response(jsonEncode({'message': 'JWT expired'}), 401);
        }
        secondAuthorization = request.headers['Authorization']!;
        return http.Response(jsonEncode({'ok': true}), 200);
      }),
    );

    final result = await client.call<Map<String, dynamic>>(
      'testagram.messages.list',
    );

    expect(requests, 2);
    expect(firstAuthorization, 'Bearer expired-jwt');
    expect(secondAuthorization, 'Bearer refreshed-jwt');
    expect(result['ok'], true);
    client.close();
  });

  test(
    'preserves a useful server error without leaking response internals',
    () async {
      final client = TestagramCapabilityClient(
        endpoint: endpoint,
        publishableKey: 'public-key',
        getAccessToken: () async => 'session-jwt',
        httpClient: MockClient((_) async => http.Response(
              jsonEncode({'message': 'Conversation membership required'}),
              403,
            )),
      );

      await expectLater(
        client.call<Map<String, dynamic>>('testagram.messages.list'),
        throwsA(
          isA<TestagramCapabilityException>()
              .having((error) => error.statusCode, 'statusCode', 403)
              .having(
                (error) => error.message,
                'message',
                'Conversation membership required',
              ),
        ),
      );
      client.close();
    },
  );

  test(
    'times out instead of leaving a request pending indefinitely',
    () async {
      final client = TestagramCapabilityClient(
        endpoint: endpoint,
        publishableKey: 'public-key',
        getAccessToken: () async => 'session-jwt',
        timeout: const Duration(milliseconds: 10),
        httpClient: MockClient((_) async {
          await Future<void>.delayed(const Duration(milliseconds: 100));
          return http.Response('{}', 200);
        }),
      );

      await expectLater(
        client.call<Map<String, dynamic>>('testagram.messages.list'),
        throwsA(
          isA<TestagramCapabilityException>()
              .having((error) => error.code, 'code', 'TIMEOUT'),
        ),
      );
      client.close();
    },
  );
}
