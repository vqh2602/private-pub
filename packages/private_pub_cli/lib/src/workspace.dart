import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pub_semver/pub_semver.dart';
import 'package:yaml/yaml.dart';
import 'package:yaml_edit/yaml_edit.dart';

import 'credentials.dart';
import 'dependency_inspector.dart';

const _dependencyGroups = [
  'dependencies',
  'dev_dependencies',
  'dependency_overrides',
];

/// Represents a package within a Dart workspace/monorepo.
final class WorkspacePackage {
  /// Creates a new [WorkspacePackage] instance.
  const WorkspacePackage({
    required this.name,
    required this.version,
    required this.directory,
    required this.pubspecSource,
    required this.pubspec,
  });

  /// The name of the package.
  final String name;

  /// The version of the package.
  final Version version;

  /// The absolute directory path containing the package.
  final String directory;

  /// The raw string content of the package's `pubspec.yaml` file.
  final String pubspecSource;

  /// The parsed YAML map of the package's `pubspec.yaml`.
  final Map<String, Object?> pubspec;
}

/// Represents the generated publishing plan for a workspace.
final class WorkspacePlan {
  /// Creates a new [WorkspacePlan] instance.
  const WorkspacePlan({
    required this.rootDirectory,
    required this.host,
    required this.packages,
    required this.order,
    required this.rewrittenPubspecs,
  });

  /// The root directory of the workspace.
  final String rootDirectory;

  /// The registry host URI where packages will be published.
  final Uri host;

  /// A map from package name to [WorkspacePackage].
  final Map<String, WorkspacePackage> packages;

  /// The topologically sorted list of package names in publication order.
  final List<String> order;

  /// A map from package name to its rewritten `pubspec.yaml` content.
  final Map<String, String> rewrittenPubspecs;
}

/// Discovers a Dart monorepo, builds its local dependency graph, and produces
/// hosted pubspec variants without changing any source file.
final class WorkspacePlanner {
  /// Creates a new [WorkspacePlanner] instance.
  const WorkspacePlanner();

  /// Prepares the publication plan for the workspace starting at [rootDirectory]
  /// targeting the given registry [rawHost].
  WorkspacePlan prepare(
    String rootDirectory,
    Uri rawHost, {
    List<String> targets = const [],
  }) {
    final root = p.normalize(p.absolute(rootDirectory));
    final host = normalizeRegistryHost(rawHost);
    final packages = discover(root);
    if (packages.isEmpty) {
      throw ProjectException('No publishable pubspec.yaml found under $root.');
    }
    final selected = targets.isEmpty ? packages.keys.toList() : targets;
    final unknown = selected.where((name) => !packages.containsKey(name));
    if (unknown.isNotEmpty) {
      throw ProjectException(
        'Unknown workspace package(s): ${unknown.join(', ')}.',
      );
    }

    final graph = <String, Set<String>>{
      for (final package in packages.values)
        package.name: _localDependencies(package, packages),
    };
    final order = _topologicalOrder(graph, selected);
    final rewrites = <String, String>{};
    for (final name in order) {
      rewrites[name] = _rewrite(packages[name]!, packages, host);
    }
    return WorkspacePlan(
      rootDirectory: root,
      host: host,
      packages: packages,
      order: order,
      rewrittenPubspecs: rewrites,
    );
  }

  /// Discovers all Dart packages with a valid `pubspec.yaml` under [rootDirectory].
  Map<String, WorkspacePackage> discover(String rootDirectory) {
    final root = Directory(p.normalize(p.absolute(rootDirectory)));
    if (!root.existsSync()) {
      throw ProjectException(
          'Workspace directory does not exist: ${root.path}.');
    }
    final files = <File>[];
    void visit(Directory directory) {
      for (final entity in directory.listSync(followLinks: false)) {
        final name = p.basename(entity.path);
        if (entity is Directory) {
          if (_ignoredDirectories.contains(name)) continue;
          visit(entity);
        } else if (entity is File && name == 'pubspec.yaml') {
          files.add(entity);
        }
      }
    }

    visit(root);
    files.sort((a, b) => a.path.compareTo(b.path));
    final packages = <String, WorkspacePackage>{};
    for (final file in files) {
      final source = file.readAsStringSync();
      final decoded = loadYaml(source);
      if (decoded is! Map) continue;
      final pubspec = _stringMap(decoded);
      final name = pubspec['name']?.toString().trim();
      final versionRaw = pubspec['version']?.toString().trim();
      if (name == null ||
          name.isEmpty ||
          versionRaw == null ||
          versionRaw.isEmpty) {
        continue;
      }
      late final Version version;
      try {
        version = Version.parse(versionRaw);
      } on FormatException {
        throw ProjectException(
            'Invalid version "$versionRaw" in ${file.path}.');
      }
      if (packages.containsKey(name)) {
        throw ProjectException(
          'Duplicate workspace package name "$name" in ${file.path} and '
          '${packages[name]!.directory}.',
        );
      }
      packages[name] = WorkspacePackage(
        name: name,
        version: version,
        directory: file.parent.path,
        pubspecSource: source,
        pubspec: pubspec,
      );
    }
    return packages;
  }

  Set<String> _localDependencies(
    WorkspacePackage package,
    Map<String, WorkspacePackage> packages,
  ) {
    final result = <String>{};
    for (final group in _dependencyGroups) {
      final dependencies = package.pubspec[group];
      if (dependencies is! Map) continue;
      for (final entry in dependencies.entries) {
        final name = entry.key.toString();
        if (packages.containsKey(name) && _isLocalReference(entry.value)) {
          result.add(name);
          continue;
        }
        if (_hasPath(entry.value)) {
          throw ProjectException(
            '${package.name} has path dependency "$name" outside the '
            'discovered workspace.',
          );
        }
      }
    }
    return result;
  }

  List<String> _topologicalOrder(
    Map<String, Set<String>> graph,
    List<String> targets,
  ) {
    final visiting = <String>{};
    final visited = <String>{};
    final result = <String>[];
    void visit(String name, List<String> trail) {
      if (visited.contains(name)) return;
      if (!visiting.add(name)) {
        final start = trail.indexOf(name);
        final cycle = [...trail.sublist(start < 0 ? 0 : start), name];
        throw ProjectException(
          'Workspace dependency cycle: ${cycle.join(' -> ')}.',
        );
      }
      final dependencies = graph[name]!.toList()..sort();
      for (final dependency in dependencies) {
        visit(dependency, [...trail, name]);
      }
      visiting.remove(name);
      visited.add(name);
      result.add(name);
    }

    final sortedTargets = [...targets]..sort();
    for (final target in sortedTargets) {
      visit(target, const []);
    }
    return result;
  }

  String _rewrite(
    WorkspacePackage package,
    Map<String, WorkspacePackage> packages,
    Uri host,
  ) {
    final editor = YamlEditor(package.pubspecSource);
    editor.update(['publish_to'], host.toString());
    for (final group in _dependencyGroups) {
      final dependencies = package.pubspec[group];
      if (dependencies is! Map) continue;
      for (final entry in dependencies.entries) {
        final name = entry.key.toString();
        final target = packages[name];
        if (target == null || !_isLocalReference(entry.value)) continue;
        editor.update(
          [group, name],
          {
            'hosted': host.toString(),
            'version': _hostedConstraint(entry.value, target.version),
          },
        );
      }
    }
    return editor.toString();
  }
}

/// Copies a package into a clean directory and swaps only its generated
/// pubspec. The source checkout remains byte-for-byte unchanged.
Future<void> materializePackage(
  WorkspacePackage package,
  String destination,
  String pubspecSource,
) async {
  final output = Directory(destination);
  if (output.existsSync()) {
    throw FileSystemException('Destination already exists.', output.path);
  }
  await output.create(recursive: true);
  await _copyDirectory(Directory(package.directory), output);
  await File(p.join(output.path, 'pubspec.yaml')).writeAsString(pubspecSource);
}

/// Rewrites the `publish_to` field of a `pubspec.yaml` string with [rawHost].
String rewritePublishTarget(String pubspecSource, Uri rawHost) {
  final editor = YamlEditor(pubspecSource);
  editor.update(['publish_to'], normalizeRegistryHost(rawHost).toString());
  return editor.toString();
}

Future<void> _copyDirectory(Directory source, Directory destination) async {
  await for (final entity in source.list(followLinks: false)) {
    final name = p.basename(entity.path);
    if (_ignoredDirectories.contains(name)) continue;
    final target = p.join(destination.path, name);
    if (entity is Directory) {
      final targetDirectory = Directory(target);
      await targetDirectory.create();
      await _copyDirectory(entity, targetDirectory);
    } else if (entity is File) {
      await entity.copy(target);
    } else if (entity is Link) {
      throw ProjectException(
        'Package contains unsupported symbolic link: ${entity.path}.',
      );
    }
  }
}

const _ignoredDirectories = {
  '.dart_tool',
  '.git',
  '.private_pub',
  '.club',
  '.ppub',
  '.fvm',
  'build',
};

bool _hasPath(Object? raw) => raw is Map && raw['path'] != null;

bool _isSdkDependency(Object? raw) => raw is Map && raw['sdk'] != null;

bool _isLocalReference(Object? raw) =>
    !_isSdkDependency(raw) &&
    !(raw is Map && (raw['hosted'] != null || raw['git'] != null));

String _hostedConstraint(Object? raw, Version version) {
  if (raw is String) {
    final value = raw.trim();
    if (value.isNotEmpty && value != 'any' && value != 'workspace') {
      return value;
    }
  }
  if (raw is Map && raw['version'] != null) {
    return raw['version'].toString();
  }
  return '^$version';
}

Map<String, Object?> _stringMap(Map value) => value.map(
      (key, value) => MapEntry(
        key.toString(),
        value is Map ? _stringMap(value) : value,
        ),
      );
