import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

final class StoredCredential {
  const StoredCredential({
    required this.host,
    required this.token,
    required this.username,
    required this.createdAt,
  });

  final Uri host;
  final String token;
  final String? username;
  final DateTime createdAt;

  Map<String, Object?> toJson() => {
        'token': token,
        if (username != null) 'username': username,
        'createdAt': createdAt.toUtc().toIso8601String(),
      };
}

/// Stores CLI credentials separately from Dart Pub's credential store.
///
/// The CLI copy is needed for registry selection, OAuth refresh-free login,
/// MCP access, and re-registering a token with a newly installed Dart SDK.
final class CredentialStore {
  CredentialStore({
    Map<String, String>? environment,
    String? filePath,
  })  : _environment = environment ?? Platform.environment,
        _explicitPath = filePath;

  final Map<String, String> _environment;
  final String? _explicitPath;

  String get filePath {
    if (_explicitPath != null) return _explicitPath;
    if (Platform.isWindows) {
      final appData = _environment['APPDATA'];
      if (appData != null && appData.isNotEmpty) {
        return p.join(appData, 'private_pub', 'credentials.json');
      }
    }
    final xdg = _environment['XDG_CONFIG_HOME'];
    if (xdg != null && xdg.isNotEmpty) {
      return p.join(xdg, 'private_pub', 'credentials.json');
    }
    final home = _environment['HOME'] ?? _environment['USERPROFILE'];
    if (home == null || home.isEmpty) {
      throw const FileSystemException(
        'Cannot locate the user configuration directory.',
      );
    }
    return p.join(home, '.config', 'private_pub', 'credentials.json');
  }

  Uri? get defaultHost {
    final raw = _read()['defaultHost'];
    return raw is String ? Uri.tryParse(raw) : null;
  }

  List<StoredCredential> list() {
    final root = _read();
    final rawServers = root['servers'];
    if (rawServers is! Map) return const [];
    final credentials = <StoredCredential>[];
    for (final entry in rawServers.entries) {
      final host = Uri.tryParse(entry.key.toString());
      final value = entry.value;
      if (host == null || value is! Map || value['token'] is! String) continue;
      credentials.add(
        StoredCredential(
          host: host,
          token: value['token'] as String,
          username: value['username'] as String?,
          createdAt: DateTime.tryParse('${value['createdAt']}') ??
              DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        ),
      );
    }
    credentials.sort((a, b) => a.host.toString().compareTo(b.host.toString()));
    return credentials;
  }

  StoredCredential? get(Uri host) {
    final canonical = normalizeRegistryHost(host);
    for (final credential in list()) {
      if (credential.host == canonical) return credential;
    }
    return null;
  }

  void save({
    required Uri host,
    required String token,
    String? username,
    bool makeDefault = true,
  }) {
    final canonical = normalizeRegistryHost(host);
    final root = _read();
    final servers = Map<String, Object?>.from(
      root['servers'] is Map
          ? Map<String, Object?>.from(root['servers'] as Map)
          : const {},
    );
    servers[canonical.toString()] = StoredCredential(
      host: canonical,
      token: token,
      username: username,
      createdAt: DateTime.now().toUtc(),
    ).toJson();
    root['servers'] = servers;
    if (makeDefault || root['defaultHost'] == null) {
      root['defaultHost'] = canonical.toString();
    }
    _write(root);
  }

  bool remove(Uri host) {
    final canonical = normalizeRegistryHost(host).toString();
    final root = _read();
    final servers = Map<String, Object?>.from(
      root['servers'] is Map
          ? Map<String, Object?>.from(root['servers'] as Map)
          : const {},
    );
    final removed = servers.remove(canonical) != null;
    if (!removed) return false;
    root['servers'] = servers;
    if (root['defaultHost'] == canonical) {
      root['defaultHost'] = servers.keys.isEmpty ? null : servers.keys.first;
    }
    _write(root);
    return true;
  }

  void clear() {
    final file = File(filePath);
    if (file.existsSync()) file.deleteSync();
  }

  void setDefault(Uri host) {
    final canonical = normalizeRegistryHost(host);
    if (get(canonical) == null) {
      throw FileSystemException(
        'No stored login for $canonical.',
        filePath,
      );
    }
    final root = _read()..['defaultHost'] = canonical.toString();
    _write(root);
  }

  Map<String, Object?> _read() {
    final file = File(filePath);
    if (!file.existsSync()) return <String, Object?>{};
    try {
      final decoded = jsonDecode(file.readAsStringSync());
      return decoded is Map
          ? Map<String, Object?>.from(decoded)
          : <String, Object?>{};
    } on FormatException catch (error) {
      throw FileSystemException(
        'Credential file is not valid JSON: ${error.message}',
        filePath,
      );
    }
  }

  void _write(Map<String, Object?> value) {
    final file = File(filePath);
    file.parent.createSync(recursive: true);
    final temporary = File('$filePath.tmp');
    temporary.writeAsStringSync(
      const JsonEncoder.withIndent('  ').convert(value),
      flush: true,
    );
    if (!Platform.isWindows) {
      Process.runSync('chmod', ['600', temporary.path]);
    } else if (file.existsSync()) {
      file.deleteSync();
    }
    temporary.renameSync(filePath);
  }
}

Uri normalizeRegistryHost(Uri host) {
  if ((host.scheme != 'http' && host.scheme != 'https') || host.host.isEmpty) {
    throw const FormatException(
      'Registry URL must be an absolute http or https URL.',
    );
  }
  if (host.userInfo.isNotEmpty) {
    throw const FormatException(
      'Registry URL must not contain embedded credentials.',
    );
  }
  return host.replace(
    path: host.path.replaceFirst(RegExp(r'/+$'), ''),
    query: null,
    fragment: null,
  );
}
