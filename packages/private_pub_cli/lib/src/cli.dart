import 'dart:async';
import 'dart:io';

import 'package:args/args.dart';
import 'package:args/command_runner.dart' show UsageException;
import 'package:path/path.dart' as p;
import 'package:pub_semver/pub_semver.dart';

import 'dependency_inspector.dart';
import 'models.dart';
import 'registry_client.dart';

typedef Environment = Map<String, String>;

final class PrivatePubCli {
  PrivatePubCli({
    IOSink? stdout,
    IOSink? stderr,
    Environment? environment,
    String? workingDirectory,
  })  : _stdout = stdout ?? ioStdout,
        _stderr = stderr ?? ioStderr,
        _environment = environment ?? Platform.environment,
        _workingDirectory = workingDirectory ?? Directory.current.path;

  static final IOSink ioStdout = stdout;
  static final IOSink ioStderr = stderr;

  final IOSink _stdout;
  final IOSink _stderr;
  final Environment _environment;
  final String _workingDirectory;
  final DependencyInspector _inspector = const DependencyInspector();

  late final ArgParser _parser = _buildParser();

  Future<int> run(List<String> arguments) async {
    try {
      final result = _parser.parse(arguments);
      if (result['help'] == true || result.command == null) {
        _printUsage();
        return result.command == null && result['help'] != true ? 64 : 0;
      }
      final command = result.command!;
      switch (command.name) {
        case 'check':
          return await _check(result, command);
        case 'versions':
          return await _versions(result, command);
        case 'compare':
          return await _compare(result, command);
        case 'outdated':
          return await _outdated(result, command);
        case 'upgrade':
          return await _upgrade(result, command);
        default:
          throw UsageException('Unknown command: ${command.name}', _usage);
      }
    } on UsageException catch (error) {
      _stderr.writeln(error.message);
      _stderr.writeln();
      _stderr.writeln(error.usage);
      return 64;
    } on ProjectException catch (error) {
      _stderr.writeln('Error: ${error.message}');
      return 66;
    } on RegistryException catch (error) {
      _stderr.writeln('Error: ${error.message}');
      return 69;
    } on FormatException catch (error) {
      _stderr.writeln('Error: ${error.message}');
      return 65;
    } on ProcessException catch (error) {
      _stderr.writeln('Error: ${error.message}');
      return 69;
    }
  }

  ArgParser _buildParser() {
    final parser = ArgParser()
      ..addFlag('help', abbr: 'h', negatable: false, help: 'Show this help.')
      ..addOption(
        'host',
        help: 'Private registry base URL (or PUB_HOSTED_URL).',
        valueHelp: 'url',
      )
      ..addOption(
        'token-env',
        defaultsTo: 'PRIVATE_PUB_TOKEN',
        help: 'Environment variable containing a registry bearer token.',
        valueHelp: 'name',
      )
      ..addOption(
        'directory',
        abbr: 'C',
        defaultsTo: '.',
        help: 'Dart/Flutter project directory.',
        valueHelp: 'path',
      )
      ..addOption(
        'sdk',
        allowed: ['auto', 'dart', 'flutter'],
        defaultsTo: 'auto',
        help: 'Pub command runner.',
      );

    parser.addCommand(
      'check',
      ArgParser()
        ..addFlag(
          'prereleases',
          negatable: false,
          help: 'Include prerelease versions when selecting latest.',
        )
        ..addFlag(
          'fail-on-outdated',
          negatable: false,
          help: 'Exit with code 1 when an update exists.',
        ),
    );
    parser.addCommand(
      'versions',
      ArgParser()
        ..addFlag(
          'retracted',
          negatable: false,
          help: 'Include retracted versions.',
        ),
    );
    parser.addCommand('compare');
    parser.addCommand(
      'outdated',
      ArgParser()
        ..addFlag('json', negatable: false)
        ..addFlag('transitive', negatable: true, defaultsTo: false)
        ..addFlag('prereleases', negatable: true, defaultsTo: true)
        ..addFlag('up-to-date', negatable: true, defaultsTo: false)
        ..addFlag('dev-dependencies', negatable: true, defaultsTo: true)
        ..addFlag('dependency-overrides', negatable: true, defaultsTo: true),
    );
    parser.addCommand(
      'upgrade',
      ArgParser()
        ..addFlag('major-versions', negatable: false)
        ..addFlag('dry-run', abbr: 'n', negatable: false)
        ..addFlag('offline', negatable: true, defaultsTo: false)
        ..addFlag('precompile', negatable: true, defaultsTo: true)
        ..addFlag('example', negatable: true, defaultsTo: true)
        ..addFlag('tighten', negatable: false)
        ..addFlag('unlock-transitive', negatable: false),
    );
    return parser;
  }

  Future<int> _check(ArgResults global, ArgResults command) async {
    final directory = _directory(global);
    final host = _resolveHost(global, directory);
    final client = _client(global, host);
    try {
      final dependencies = _inspector.inspect(directory).where((item) {
        if (item.constraint.startsWith('sdk:')) return false;
        if (item.hostedUrl != null) return _sameHost(item.hostedUrl!, host);
        return _hasConfiguredHost(global);
      }).toList();
      if (dependencies.isEmpty) {
        _stdout.writeln('No hosted dependencies found for $host.');
        return 0;
      }

      final rows = <List<String>>[];
      var outdated = 0;
      var errors = 0;
      for (final dependency in dependencies) {
        try {
          final package = await client.getPackage(dependency.name);
          final latest = package.latest(
            includePrereleases: command['prereleases'] as bool,
          );
          final current = dependency.current;
          final status = latest == null
              ? 'no active version'
              : current == null
                  ? 'not locked'
                  : current < latest.version
                      ? 'update available'
                      : current == latest.version
                          ? 'up to date'
                          : 'ahead';
          if (status == 'update available') outdated++;
          rows.add([
            dependency.name,
            current?.toString() ?? '-',
            dependency.constraint,
            latest?.version.toString() ?? '-',
            status,
          ]);
        } on RegistryException catch (error) {
          errors++;
          rows.add([
            dependency.name,
            dependency.current?.toString() ?? '-',
            dependency.constraint,
            '-',
            error.message,
          ]);
        }
      }
      _printTable(
          ['Package', 'Current', 'Constraint', 'Latest', 'Status'], rows);
      _stdout.writeln();
      _stdout.writeln('$outdated package(s) have a newer version at $host.');
      if (errors > 0) {
        _stdout.writeln('$errors package(s) could not be checked.');
        return 69;
      }
      return command['fail-on-outdated'] == true && outdated > 0 ? 1 : 0;
    } finally {
      client.close();
    }
  }

  Future<int> _versions(ArgResults global, ArgResults command) async {
    if (command.rest.length != 1) {
      throw UsageException(
        'Usage: private_pub versions <package>',
        _usage,
      );
    }
    final directory = _directory(global);
    final client = _client(global, _resolveHost(global, directory));
    try {
      final package = await client.getPackage(command.rest.single);
      final items = package.versions
          .where((item) => command['retracted'] == true || !item.retracted)
          .toList()
        ..sort((a, b) => b.version.compareTo(a.version));
      _printTable(
        ['Version', 'Published', 'Status'],
        items
            .map((item) => [
                  item.version.toString(),
                  item.published?.toIso8601String() ?? '-',
                  item.retracted ? 'retracted' : 'active',
                ])
            .toList(),
      );
      return 0;
    } finally {
      client.close();
    }
  }

  Future<int> _compare(ArgResults global, ArgResults command) async {
    if (command.rest.length != 3) {
      throw UsageException(
        'Usage: private_pub compare <package> <from> <to>',
        _usage,
      );
    }
    final packageName = command.rest[0];
    final from = Version.parse(command.rest[1]);
    final to = Version.parse(command.rest[2]);
    final directory = _directory(global);
    final client = _client(global, _resolveHost(global, directory));
    try {
      final package = await client.getPackage(packageName);
      final fromItem = _findVersion(package, from);
      final toItem = _findVersion(package, to);
      _stdout
          .writeln('$packageName: $from -> $to (${_versionChange(from, to)})');
      _stdout.writeln();
      _printTable(
        ['Field', from.toString(), to.toString()],
        [
          [
            'Published',
            fromItem.published?.toIso8601String() ?? '-',
            toItem.published?.toIso8601String() ?? '-'
          ],
          ['Retracted', '${fromItem.retracted}', '${toItem.retracted}'],
          ['SDK', _sdkConstraint(fromItem), _sdkConstraint(toItem)],
          ['Flutter', _flutterConstraint(fromItem), _flutterConstraint(toItem)],
        ],
      );
      final changes = _dependencyChanges(fromItem.pubspec, toItem.pubspec);
      _stdout.writeln();
      if (changes.isEmpty) {
        _stdout.writeln('Dependency constraints are unchanged.');
      } else {
        _printTable(['Dependency', 'From', 'To'], changes);
      }
      return 0;
    } finally {
      client.close();
    }
  }

  Future<int> _outdated(ArgResults global, ArgResults command) {
    final args = <String>['pub', 'outdated'];
    _forwardBool(command, args, 'json', negatable: false);
    _forwardBool(command, args, 'transitive');
    _forwardBool(command, args, 'prereleases');
    _forwardBool(command, args, 'up-to-date');
    _forwardBool(command, args, 'dev-dependencies');
    _forwardBool(command, args, 'dependency-overrides');
    return _runPub(global, args);
  }

  Future<int> _upgrade(ArgResults global, ArgResults command) {
    final args = <String>['pub', 'upgrade'];
    _forwardBool(command, args, 'major-versions', negatable: false);
    _forwardBool(command, args, 'dry-run', negatable: false);
    _forwardBool(command, args, 'offline');
    _forwardBool(command, args, 'precompile');
    _forwardBool(command, args, 'example');
    _forwardBool(command, args, 'tighten', negatable: false);
    _forwardBool(command, args, 'unlock-transitive', negatable: false);
    args.addAll(command.rest);
    return _runPub(global, args);
  }

  Future<int> _runPub(ArgResults global, List<String> arguments) async {
    final directory = _directory(global);
    final requestedSdk = global['sdk'] as String;
    final executable = requestedSdk == 'auto'
        ? (_inspector.isFlutterProject(directory) ? 'flutter' : 'dart')
        : requestedSdk;
    final environment = Map<String, String>.from(_environment)
      ..remove('PUB_HOSTED_URL');
    _stderr.writeln('Running: $executable ${arguments.join(' ')}');
    if (_hasConfiguredHost(global)) {
      _stderr.writeln(
        'Note: PUB_HOSTED_URL is not forwarded to Pub. Declare private '
        'dependencies with `hosted:` in pubspec.yaml so public packages keep '
        'using pub.dev.',
      );
    }
    final process = await Process.start(
      executable,
      arguments,
      workingDirectory: directory,
      environment: environment,
      mode: ProcessStartMode.inheritStdio,
      runInShell: Platform.isWindows,
    );
    return process.exitCode;
  }

  RegistryClient _client(ArgResults global, Uri host) {
    final tokenEnv = global['token-env'] as String;
    return RegistryClient(host: host, token: _environment[tokenEnv]);
  }

  String _directory(ArgResults result) {
    final raw = result['directory'] as String;
    return p.normalize(p.absolute(_workingDirectory, raw));
  }

  Uri _resolveHost(ArgResults result, String directory) {
    final raw = result['host'] as String? ?? _environment['PUB_HOSTED_URL'];
    if (raw != null && raw.trim().isNotEmpty) {
      return _parseHost(raw);
    }
    final urls = _inspector.hostedUrls(directory);
    if (urls.length == 1) return urls.single;
    throw UsageException(
      'Private registry is required. Use --host or set PUB_HOSTED_URL.',
      _usage,
    );
  }

  bool _hasConfiguredHost(ArgResults result) {
    final option = result['host'] as String?;
    return (option != null && option.trim().isNotEmpty) ||
        (_environment['PUB_HOSTED_URL']?.trim().isNotEmpty ?? false);
  }

  Uri _parseHost(String raw) {
    final uri = Uri.tryParse(raw);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      throw FormatException('Invalid private registry URL: $raw');
    }
    return uri;
  }

  bool _sameHost(Uri first, Uri second) =>
      first.scheme == second.scheme &&
      first.host == second.host &&
      first.port == second.port &&
      first.path.replaceFirst(RegExp(r'/+$'), '') ==
          second.path.replaceFirst(RegExp(r'/+$'), '');

  RegistryVersion _findVersion(RegistryPackage package, Version version) {
    for (final item in package.versions) {
      if (item.version == version) return item;
    }
    throw RegistryException(
      'Version $version of ${package.name} was not found.',
    );
  }

  String _versionChange(Version from, Version to) {
    if (from == to) return 'same';
    final direction = to > from ? '' : 'downgrade ';
    if (from.major != to.major) return '${direction}major';
    if (from.minor != to.minor) return '${direction}minor';
    if (from.patch != to.patch) return '${direction}patch';
    if (from.preRelease != to.preRelease) return '${direction}prerelease';
    return '${direction}build metadata';
  }

  String _sdkConstraint(RegistryVersion item) {
    final environment = item.pubspec['environment'];
    return environment is Map ? '${environment['sdk'] ?? '-'}' : '-';
  }

  String _flutterConstraint(RegistryVersion item) {
    final environment = item.pubspec['environment'];
    return environment is Map ? '${environment['flutter'] ?? '-'}' : '-';
  }

  List<List<String>> _dependencyChanges(
    Map<String, Object?> from,
    Map<String, Object?> to,
  ) {
    final left = _constraints(from);
    final right = _constraints(to);
    final names = {...left.keys, ...right.keys}.toList()..sort();
    return [
      for (final name in names)
        if (left[name] != right[name])
          [name, left[name] ?? '-', right[name] ?? '-'],
    ];
  }

  Map<String, String> _constraints(Map<String, Object?> pubspec) {
    final result = <String, String>{};
    for (final group in ['dependencies', 'dev_dependencies']) {
      final value = pubspec[group];
      if (value is! Map) continue;
      for (final entry in value.entries) {
        result[entry.key.toString()] = _describeConstraint(entry.value);
      }
    }
    return result;
  }

  String _describeConstraint(Object? value) {
    if (value is String) return value;
    if (value is Map) {
      if (value['version'] != null) return '${value['version']}';
      if (value['sdk'] != null) return 'sdk:${value['sdk']}';
      if (value['path'] != null) return 'path:${value['path']}';
      if (value['git'] != null) return 'git';
    }
    return '$value';
  }

  void _forwardBool(
    ArgResults command,
    List<String> output,
    String name, {
    bool negatable = true,
  }) {
    if (!command.wasParsed(name)) return;
    final enabled = command[name] as bool;
    if (enabled) {
      output.add('--$name');
    } else if (negatable) {
      output.add('--no-$name');
    }
  }

  void _printTable(List<String> headers, List<List<String>> rows) {
    final widths = List<int>.generate(headers.length, (index) {
      var width = headers[index].length;
      for (final row in rows) {
        if (index < row.length && row[index].length > width) {
          width = row[index].length;
        }
      }
      return width;
    });
    String line(List<String> cells) => List.generate(
          headers.length,
          (index) => cells[index].padRight(widths[index]),
        ).join('  ').trimRight();
    _stdout.writeln(line(headers));
    _stdout.writeln(line(widths.map((width) => '-' * width).toList()));
    for (final row in rows) {
      _stdout.writeln(line(row));
    }
  }

  void _printUsage() => _stdout.writeln(_usage);

  String get _usage => '''
Inspect and update packages in a private Dart/Flutter Pub registry.

Usage: private_pub [global options] <command> [arguments]

Global options:
${_parser.usage}

Commands:
  check                         Compare project locks with registry versions
  versions <package>            List versions published in the registry
  compare <package> <from> <to> Compare SDK and dependency constraints
  outdated                      Run dart/flutter pub outdated
  upgrade [packages...]         Run dart/flutter pub upgrade

Examples:
  private_pub --host https://pub.company.dev check
  private_pub versions company_ui
  private_pub compare company_ui 1.2.0 2.0.0
  private_pub outdated --transitive
  private_pub upgrade
  private_pub upgrade --major-versions --dry-run
''';
}
