import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import 'credentials.dart';
import 'registry_client.dart';

typedef BrowserOpener = Future<bool> Function(Uri uri);

final class LoginResult {
  const LoginResult({required this.token, required this.username});

  final String token;
  final String? username;
}

final class OAuthLoginClient {
  OAuthLoginClient({
    http.Client? httpClient,
    BrowserOpener? browserOpener,
    Random? random,
  })  : _httpClient = httpClient ?? http.Client(),
        _ownsClient = httpClient == null,
        _browserOpener = browserOpener ?? openSystemBrowser,
        _random = random ?? Random.secure();

  final http.Client _httpClient;
  final bool _ownsClient;
  final BrowserOpener _browserOpener;
  final Random _random;

  Future<LoginResult> loginWithBrowser(
    Uri rawHost, {
    void Function(Uri authorizationUrl)? onAuthorizationUrl,
    Duration timeout = const Duration(minutes: 5),
  }) async {
    final host = normalizeRegistryHost(rawHost);
    _requireSecureRemote(host);
    final verifier = _randomBase64Url(64);
    final challenge = base64Url
        .encode(sha256.convert(ascii.encode(verifier)).bytes)
        .replaceAll('=', '');
    final state = _randomBase64Url(32);
    final callbackServer = await HttpServer.bind(
      InternetAddress.loopbackIPv4,
      0,
    );
    final redirectUri = Uri.parse(
      'http://127.0.0.1:${callbackServer.port}/oauth/callback',
    );
    final completion = Completer<String>();
    late final StreamSubscription<HttpRequest> subscription;
    subscription = callbackServer.listen((request) async {
      if (request.uri.path != '/oauth/callback') {
        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
        return;
      }
      final returnedState = request.uri.queryParameters['state'];
      final error = request.uri.queryParameters['error'];
      final code = request.uri.queryParameters['code'];
      final valid = error == null && returnedState == state && code != null;
      request.response
        ..statusCode = HttpStatus.ok
        ..headers.contentType = ContentType.html
        ..write(_callbackPage(valid, error));
      await request.response.close();
      if (completion.isCompleted) return;
      if (error != null) {
        completion.completeError(RegistryException(error));
      } else if (returnedState != state) {
        completion.completeError(
          const RegistryException('OAuth state mismatch.'),
        );
      } else if (code == null || code.isEmpty) {
        completion.completeError(
          const RegistryException('OAuth callback did not contain a code.'),
        );
      } else {
        completion.complete(code);
      }
    });

    final authorizationUrl = host.resolve('/oauth/authorize').replace(
      queryParameters: {
        'response_type': 'code',
        'client_id': 'private_pub_cli',
        'redirect_uri': redirectUri.toString(),
        'code_challenge': challenge,
        'code_challenge_method': 'S256',
        'state': state,
        'scope': 'packages:read packages:publish imports:write',
      },
    );
    onAuthorizationUrl?.call(authorizationUrl);
    await _browserOpener(authorizationUrl);

    try {
      final code = await completion.future.timeout(timeout);
      final response = await _httpClient.post(
        host.resolve('/oauth/token'),
        headers: const {
          'content-type': 'application/x-www-form-urlencoded',
          'accept': 'application/json',
        },
        body: {
          'grant_type': 'authorization_code',
          'client_id': 'private_pub_cli',
          'code': code,
          'redirect_uri': redirectUri.toString(),
          'code_verifier': verifier,
        },
      ).timeout(const Duration(seconds: 30));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw RegistryException(
          _errorMessage(response.body) ??
              'OAuth token exchange returned HTTP ${response.statusCode}.',
        );
      }
      final payload = jsonDecode(response.body);
      if (payload is! Map || payload['access_token'] is! String) {
        throw const RegistryException(
          'OAuth token response did not contain access_token.',
        );
      }
      return LoginResult(
        token: payload['access_token'] as String,
        username: payload['username'] as String?,
      );
    } on TimeoutException {
      throw const RegistryException('OAuth login timed out.');
    } on http.ClientException catch (error) {
      throw RegistryException('OAuth request failed: ${error.message}');
    } finally {
      await subscription.cancel();
      await callbackServer.close(force: true);
    }
  }

  Future<LoginResult> validateToken(Uri rawHost, String token) async {
    final host = normalizeRegistryHost(rawHost);
    _requireSecureRemote(host);
    final response = await _httpClient.get(
      host.resolve('/v1/auth/me'),
      headers: {
        'accept': 'application/json',
        'authorization': 'Bearer $token',
      },
    ).timeout(const Duration(seconds: 30));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RegistryException(
        _errorMessage(response.body) ??
            'Registry rejected the token (HTTP ${response.statusCode}).',
      );
    }
    final payload = jsonDecode(response.body);
    final user = payload is Map ? payload['user'] : null;
    return LoginResult(
      token: token,
      username: user is Map ? user['username'] as String? : null,
    );
  }

  String _randomBase64Url(int byteCount) => base64Url
      .encode(List<int>.generate(byteCount, (_) => _random.nextInt(256)))
      .replaceAll('=', '');

  void close() {
    if (_ownsClient) _httpClient.close();
  }
}

Future<bool> openSystemBrowser(Uri uri) async {
  final executable = Platform.isMacOS
      ? 'open'
      : Platform.isWindows
          ? 'rundll32'
          : 'xdg-open';
  final arguments = Platform.isWindows
      ? ['url.dll,FileProtocolHandler', uri.toString()]
      : [uri.toString()];
  try {
    final result = await Process.run(executable, arguments);
    return result.exitCode == 0;
  } on ProcessException {
    return false;
  }
}

void _requireSecureRemote(Uri host) {
  final isLoopback = host.host == 'localhost' ||
      host.host == '127.0.0.1' ||
      host.host == '::1';
  if (host.scheme != 'https' && !isLoopback) {
    throw const RegistryException(
      'OAuth login requires HTTPS except for a loopback registry.',
    );
  }
}

String? _errorMessage(String body) {
  try {
    final decoded = jsonDecode(body);
    if (decoded is Map) {
      if (decoded['message'] is String) return decoded['message'] as String;
      if (decoded['error_description'] is String) {
        return decoded['error_description'] as String;
      }
      if (decoded['error'] is String) return decoded['error'] as String;
    }
  } on FormatException {
    return null;
  }
  return null;
}

String _callbackPage(bool success, String? error) => '''
<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Private Pub CLI login</title>
  <body style="font:16px system-ui;max-width:42rem;margin:10vh auto;padding:2rem">
    <h1>${success ? 'Authentication complete' : 'Authentication failed'}</h1>
    <p>${success ? 'You can close this window and return to the terminal.' : (error ?? 'The authorization response was invalid.')}</p>
  </body>
</html>
''';
