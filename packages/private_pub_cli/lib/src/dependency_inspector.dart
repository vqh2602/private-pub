import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pub_semver/pub_semver.dart';
import 'package:yaml/yaml.dart';

import 'models.dart';

/// Exception thrown when workspace/project dependency validation fails.
final class ProjectException implements Exception {
  /// Creates a new [ProjectException] instance with a [message].
  const ProjectException(this.message);

  /// The error message.
  final String message;

  @override
  String toString() => message;
}

/// Inspects local project dependencies using `pubspec.yaml` and `pubspec.lock`.
final class DependencyInspector {
  /// Creates a new [DependencyInspector] instance.
  const DependencyInspector();

  /// Inspects a directory to find all package dependencies.
  List<ProjectDependency> inspect(String directory) {
    final pubspecFile = File(p.join(directory, 'pubspec.yaml'));
    if (!pubspecFile.existsSync()) {
      throw ProjectException('No pubspec.yaml found in $directory.');
    }
    final pubspec = _map(loadYaml(pubspecFile.readAsStringSync()));
    final lockFile = File(p.join(directory, 'pubspec.lock'));
    final locked = lockFile.existsSync()
        ? _lockedVersions(_map(loadYaml(lockFile.readAsStringSync())))
        : <String, Version>{};

    final result = <ProjectDependency>[];
    _readGroup(
        pubspec, 'dependencies', DependencyKind.dependency, locked, result);
    _readGroup(
      pubspec,
      'dev_dependencies',
      DependencyKind.devDependency,
      locked,
      result,
    );
    _readGroup(
      pubspec,
      'dependency_overrides',
      DependencyKind.override,
      locked,
      result,
    );
    return result;
  }

  /// Gets all hosted dependency registry URLs for the project.
  Set<Uri> hostedUrls(String directory) =>
      inspect(directory).map((item) => item.hostedUrl).whereType<Uri>().toSet();

  /// Checks whether a project has a dependency on the Flutter SDK.
  bool isFlutterProject(String directory) {
    return inspect(directory).any(
      (item) => item.name == 'flutter' && item.constraint == 'sdk:flutter',
    );
  }

  void _readGroup(
    Map<String, Object?> pubspec,
    String key,
    DependencyKind kind,
    Map<String, Version> locked,
    List<ProjectDependency> output,
  ) {
    final groupValue = pubspec[key];
    if (groupValue is! Map) return;
    for (final entry in groupValue.entries) {
      final name = entry.key.toString();
      final parsed = _parseDescription(entry.value);
      if (parsed == null) continue;
      output.add(ProjectDependency(
        name: name,
        constraint: parsed.$1,
        hostedUrl: parsed.$2,
        current: locked[name],
        kind: kind,
      ));
    }
  }

  (String, Uri?)? _parseDescription(Object? raw) {
    if (raw is String) return (raw, null);
    if (raw is! Map) return null;
    final map = _map(raw);
    if (map['sdk'] != null) return ('sdk:${map['sdk']}', null);
    if (map['path'] != null || map['git'] != null) return null;
    final constraint = map['version']?.toString() ?? 'any';
    final hosted = map['hosted'];
    if (hosted is String) return (constraint, Uri.tryParse(hosted));
    if (hosted is Map) {
      final url = _map(hosted)['url']?.toString();
      return (constraint, url == null ? null : Uri.tryParse(url));
    }
    return (constraint, null);
  }

  Map<String, Version> _lockedVersions(Map<String, Object?> lock) {
    final packages = lock['packages'];
    if (packages is! Map) return {};
    return {
      for (final entry in packages.entries)
        if (_map(entry.value)['version'] case final String version)
          entry.key.toString(): Version.parse(version),
    };
  }

  Map<String, Object?> _map(Object? value) {
    if (value is! Map) return {};
    return value.map((key, value) => MapEntry(key.toString(), value));
  }
}
