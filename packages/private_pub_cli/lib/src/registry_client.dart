import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:pub_semver/pub_semver.dart';

import 'models.dart';

/// Exception thrown when registry operations or network requests fail.
final class RegistryException implements Exception {
  /// Creates a new [RegistryException] with the given [message].
  const RegistryException(this.message);

  /// The error message.
  final String message;

  @override
  String toString() => message;
}

/// A client to interact with the private Hosted Pub registry.
final class RegistryClient {
  /// Creates a new [RegistryClient] instance.
  ///
  /// Requires a [host] URI. Optionally takes an authentication [token] and
  /// a custom [httpClient].
  RegistryClient({
    required Uri host,
    this.token,
    http.Client? httpClient,
  })  : host = _normalizeHost(host),
        _httpClient = httpClient ?? http.Client(),
        _ownsClient = httpClient == null {
    if (token != null &&
        token!.isNotEmpty &&
        this.host.scheme != 'https' &&
        !_isLoopback(this.host.host)) {
      throw const RegistryException(
        'Refusing to send a bearer token over HTTP to a non-loopback host.',
      );
    }
  }

  /// The normalized URI of the registry host.
  final Uri host;

  /// The authentication token, if any.
  final String? token;
  final http.Client _httpClient;
  final bool _ownsClient;

  Map<String, String> get _headers => {
        'Accept': 'application/json',
        if (token != null && token!.isNotEmpty)
          'Authorization': 'Bearer $token',
      };

  static Uri _normalizeHost(Uri host) {
    if (host.scheme != 'http' && host.scheme != 'https') {
      throw const RegistryException('Registry URL must use http or https.');
    }
    if (host.userInfo.isNotEmpty) {
      throw const RegistryException(
        'Registry URL must not contain embedded credentials.',
      );
    }
    return host.replace(
      path: host.path.replaceFirst(RegExp(r'/+$'), ''),
      query: null,
      fragment: null,
    );
  }

  /// Fetches package metadata from the registry.
  Future<RegistryPackage> getPackage(String packageName) async {
    final basePath = host.path.isEmpty ? '' : host.path;
    final uri = host.replace(
      path: '$basePath/api/packages/${Uri.encodeComponent(packageName)}',
      query: null,
      fragment: null,
    );
    late final http.Response response;
    try {
      response = await _httpClient.get(uri, headers: {
        'Accept': 'application/vnd.pub.v2+json',
        if (token != null && token!.isNotEmpty)
          'Authorization': 'Bearer $token',
      }).timeout(const Duration(seconds: 30));
    } on http.ClientException catch (error) {
      throw RegistryException('Cannot connect to $host: ${error.message}');
    } on TimeoutException {
      throw RegistryException('Registry request to $host timed out.');
    }
    if (response.statusCode == 404) {
      throw RegistryException(
        'Package "$packageName" was not found at $host.',
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RegistryException(
        'Registry returned HTTP ${response.statusCode} for "$packageName".',
      );
    }

    try {
      final root = jsonDecode(response.body) as Map<String, Object?>;
      final rawVersions = root['versions'] as List<Object?>;
      final versions = rawVersions.map((raw) {
        final value = raw as Map<String, Object?>;
        return RegistryVersion(
          version: Version.parse(value['version'] as String),
          pubspec: Map<String, Object?>.from(
            value['pubspec'] as Map<Object?, Object?>,
          ),
          retracted: value['retracted'] == true,
          published: value['published'] is String
              ? DateTime.tryParse(value['published'] as String)
              : null,
        );
      }).toList();
      return RegistryPackage(
        name: (root['name'] as String?) ?? packageName,
        versions: versions,
      );
    } on Object catch (error) {
      throw RegistryException(
        'Invalid Hosted Pub metadata for "$packageName": $error',
      );
    }
  }

  /// Searches the registry using the given [query] and [limit].
  Future<Map<String, Object?>> search(
    String query, {
    int limit = 10,
  }) =>
      _getJson('/v1/search', query: {
        'q': query,
        'limit': '$limit',
        'page': '1',
      });

  /// Fetches details of the package from the control plane API.
  Future<Map<String, Object?>> getPackageDetail(String packageName) =>
      _getJson('/v1/packages/${Uri.encodeComponent(packageName)}');

  /// Fetches files listed in a specific package version.
  Future<Map<String, Object?>> getPackageFiles(
    String packageName,
    String version,
  ) =>
      _getJson(
        '/v1/packages/${Uri.encodeComponent(packageName)}'
        '/versions/${Uri.encodeComponent(version)}/files',
      );

  /// Fetches a specific file from a package version.
  Future<Map<String, Object?>> getPackageFile(
    String packageName,
    String version,
    String path,
  ) {
    final encodedPath = path
        .split('/')
        .where((part) => part.isNotEmpty)
        .map(Uri.encodeComponent)
        .join('/');
    if (encodedPath.isEmpty || path.split('/').contains('..')) {
      throw const RegistryException('Package file path is invalid.');
    }
    return _getJson(
      '/v1/packages/${Uri.encodeComponent(packageName)}'
      '/versions/${Uri.encodeComponent(version)}/files/$encodedPath',
    );
  }

  Future<Map<String, Object?>> _getJson(
    String path, {
    Map<String, String>? query,
  }) async {
    final basePath = host.path.isEmpty ? '' : host.path;
    final uri = host.replace(
      path: '$basePath$path',
      queryParameters: query,
      fragment: null,
    );
    late final http.Response response;
    try {
      response = await _httpClient
          .get(uri, headers: _headers)
          .timeout(const Duration(seconds: 30));
    } on http.ClientException catch (error) {
      throw RegistryException('Cannot connect to $host: ${error.message}');
    } on TimeoutException {
      throw RegistryException('Registry request to $host timed out.');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RegistryException(
        'Registry returned HTTP ${response.statusCode} for $path.',
      );
    }
    try {
      final value = jsonDecode(response.body);
      if (value is! Map) throw const FormatException('Expected an object.');
      return Map<String, Object?>.from(value);
    } on Object catch (error) {
      throw RegistryException('Invalid registry response for $path: $error');
    }
  }

  static bool _isLoopback(String host) =>
      host == 'localhost' || host == '127.0.0.1' || host == '::1';

  /// Closes the HTTP client.
  void close() {
    if (_ownsClient) _httpClient.close();
  }
}
