import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:pub_semver/pub_semver.dart';

import 'models.dart';

final class RegistryException implements Exception {
  const RegistryException(this.message);

  final String message;

  @override
  String toString() => message;
}

final class RegistryClient {
  RegistryClient({
    required Uri host,
    this.token,
    http.Client? httpClient,
  })  : host = _normalizeHost(host),
        _httpClient = httpClient ?? http.Client(),
        _ownsClient = httpClient == null;

  final Uri host;
  final String? token;
  final http.Client _httpClient;
  final bool _ownsClient;

  static Uri _normalizeHost(Uri host) {
    if (host.scheme != 'http' && host.scheme != 'https') {
      throw const RegistryException('Registry URL must use http or https.');
    }
    return host.replace(path: host.path.replaceFirst(RegExp(r'/+$'), ''));
  }

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
      });
    } on http.ClientException catch (error) {
      throw RegistryException('Cannot connect to $host: ${error.message}');
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

  void close() {
    if (_ownsClient) _httpClient.close();
  }
}
