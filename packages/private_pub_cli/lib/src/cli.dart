import 'dart:async';
import 'dart:io';

import 'package:args/args.dart';
import 'package:args/command_runner.dart' show UsageException;
import 'package:path/path.dart' as p;
import 'package:pub_semver/pub_semver.dart';
import 'package:yaml_edit/yaml_edit.dart';

import 'credentials.dart';
import 'dependency_inspector.dart';
import 'mcp_server.dart';
import 'models.dart';
import 'oauth_login.dart';
import 'pub_token.dart';
import 'registry_client.dart';
import 'workspace.dart';

/// Represents the environment variables map.
typedef Environment = Map<String, String>;

/// Factory function type for creating a [RegistryClient].
typedef RegistryClientFactory = RegistryClient Function(
  Uri host,
  String? token,
);

/// The main command line interface class for Private Pub CLI.
final class PrivatePubCli {
  /// Creates a new [PrivatePubCli] instance.
  PrivatePubCli({
    IOSink? stdout,
    IOSink? stderr,
    Environment? environment,
    String? workingDirectory,
    CredentialStore? credentialStore,
    PubTokenRegistrar? pubTokenRegistrar,
    RegistryClientFactory? registryClientFactory,
  })  : _stdout = stdout ?? ioStdout,
        _stderr = stderr ?? ioStderr,
        _environment = environment ?? Platform.environment,
        _workingDirectory = workingDirectory ?? Directory.current.path,
        _credentials = credentialStore ??
            CredentialStore(environment: environment ?? Platform.environment),
        _pubTokens = pubTokenRegistrar ??
            PubTokenRegistrar(
              fvmExecutable:
                  (environment ?? Platform.environment)['FVM_EXECUTABLE'] ??
                      'fvm',
              useFvm: ((environment ?? Platform.environment)['USE_FVM'] == 'true') ||
                  ((environment ?? Platform.environment)['FVM_EXECUTABLE'] != null &&
                      (environment ?? Platform.environment)['FVM_EXECUTABLE']!.trim().isNotEmpty),
            ),
        _registryClientFactory = registryClientFactory ??
            ((host, token) => RegistryClient(host: host, token: token));

  /// The standard output sink wrapper.
  static final IOSink ioStdout = stdout;

  /// The standard error sink wrapper.
  static final IOSink ioStderr = stderr;

  final IOSink _stdout;
  final IOSink _stderr;
  final Environment _environment;
  final String _workingDirectory;
  final CredentialStore _credentials;
  final PubTokenRegistrar _pubTokens;
  final RegistryClientFactory _registryClientFactory;
  final DependencyInspector _inspector = const DependencyInspector();
  final WorkspacePlanner _workspace = const WorkspacePlanner();

  late final ArgParser _parser = _buildParser();

  /// Runs the command line application with the specified [arguments].
  ///
  /// Returns the exit code (0 for success).
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
        case 'login':
          return await _login(result, command);
        case 'logout':
          return _logout(result, command);
        case 'setup':
          return await _setup(result, command);
        case 'publish':
          return await _publish(result, command);
        case 'prepare':
          return await _prepare(result, command);
        case 'mcp':
          return await _mcp(result, command);
        case 'config':
          return _config(result, command);
        case 'add':
          return await _add(result, command);
        case 'global':
          return await _global(result, command);
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
    } on FileSystemException catch (error) {
      _stderr.writeln('Error: ${error.message}');
      return 74;
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
    parser.addCommand(
      'login',
      ArgParser()
        ..addFlag(
          'setup',
          defaultsTo: true,
          help: 'Also register the OAuth token with fvm dart pub.',
        )
        ..addFlag(
          'no-browser',
          negatable: false,
          help: 'Do not open the system browser.',
        )
        ..addOption(
          'key',
          help: 'Directly use a token instead of OAuth.',
        ),
    );
    parser.addCommand(
      'logout',
      ArgParser()
        ..addOption('server', help: 'Server host to log out from.')
        ..addFlag('all', negatable: false, help: 'Log out from all servers.'),
    );
    parser.addCommand(
      'setup',
      ArgParser()
        ..addOption(
          'env-var',
          help: 'Register an environment variable instead of a stored token.',
          valueHelp: 'name',
        ),
    );
    parser.addCommand(
      'publish',
      ArgParser()
        ..addFlag('auto', negatable: false)
        ..addFlag('dry-run', abbr: 'n', negatable: false)
        ..addFlag('force', abbr: 'f', negatable: false)
        ..addFlag('skip-validation', negatable: false)
        ..addFlag('ignore-warnings', negatable: false),
    );
    parser.addCommand(
      'prepare',
      ArgParser()
        ..addOption(
          'output',
          abbr: 'o',
          help: 'Directory for generated publish-ready package copies.',
          valueHelp: 'path',
        )
        ..addFlag('dry-run', abbr: 'n', negatable: false),
    );
    parser.addCommand(
      'mcp',
      ArgParser()
        ..addOption('server', help: 'Server host.')
        ..addOption('token', help: 'Bearer token/PAT.'),
    );
    final configParser = ArgParser();
    configParser.addCommand('show');
    configParser.addCommand('set-server');
    parser.addCommand('config', configParser);
    parser.addCommand('add');
    final globalParser = ArgParser();
    globalParser.addCommand('activate');
    globalParser.addCommand('deactivate');
    parser.addCommand('global', globalParser);
    return parser;
  }

  Future<int> _login(ArgResults global, ArgResults command) async {
    final host = _commandHost(global, command);
    final noBrowser = command['no-browser'] == true;
    final client = OAuthLoginClient(
      browserOpener: noBrowser ? (uri) async => true : null,
    );
    try {
      final key = command['key'] as String?;
      if (key != null && key.isNotEmpty) {
        _stdout.writeln('Validating key/token for $host ...');
        final result = await client.validateToken(host, key);
        _credentials.save(
          host: host,
          token: key,
          username: result.username,
        );
        if (command['setup'] == true) {
          await _pubTokens.registerToken(host, key);
        }
        _stdout.writeln(
          'Logged in to $host${result.username == null ? '' : ' as ${result.username}'}.',
        );
        return 0;
      }

      if (noBrowser) {
        _stdout.writeln('Please open the following authorization URL in your browser:');
      } else {
        _stdout.writeln('Opening a browser to authorize $host ...');
      }
      final result = await client.loginWithBrowser(
        host,
        onAuthorizationUrl: (url) {
          if (!noBrowser) {
            _stdout.writeln('If the browser does not open, visit:');
          }
          _stdout.writeln(url);
        },
      );
      _credentials.save(
        host: host,
        token: result.token,
        username: result.username,
      );
      if (command['setup'] == true) {
        await _pubTokens.registerToken(host, result.token);
      }
      _stdout.writeln(
        'Logged in to $host${result.username == null ? '' : ' as ${result.username}'}.',
      );
      if (command['setup'] == true) {
        _stdout.writeln('Dart Pub token storage is configured.');
      }
      return 0;
    } finally {
      client.close();
    }
  }

  int _logout(ArgResults global, ArgResults command) {
    if (command['all'] == true) {
      final credentials = _credentials.list();
      if (credentials.isEmpty) {
        _stdout.writeln('No stored credentials found.');
        return 0;
      }
      for (final cred in credentials) {
        _credentials.remove(cred.host);
        _stdout.writeln('Removed credentials for ${cred.host}');
      }
      _stdout.writeln('All stored credentials removed.');
      return 0;
    }

    final server = command['server'] as String?;
    final host = server != null ? _parseHost(server) : _commandHost(global, command, requireLogin: false);
    if (!_credentials.remove(host)) {
      _stdout.writeln('No stored login for $host.');
      return 0;
    }
    _stdout.writeln('Removed the stored CLI login for $host.');
    _stdout.writeln(
      'Run `fvm dart pub token remove $host` to also remove the Dart SDK copy.',
    );
    return 0;
  }

  Future<int> _setup(ArgResults global, ArgResults command) async {
    final host = _commandHost(global, command);
    final envVar = command['env-var'] as String?;
    if (envVar != null) {
      await _pubTokens.registerEnvironment(host, envVar);
      _stdout.writeln('Dart Pub will read the token from $envVar for $host.');
      return 0;
    }
    final credential = _credentials.get(host);
    if (credential == null) {
      throw UsageException(
          'Not logged in to $host. Run `ppub login $host`.', _usage);
    }
    await _pubTokens.registerToken(host, credential.token);
    _stdout.writeln('Registered the stored token with Dart Pub for $host.');
    return 0;
  }

  Future<int> _publish(ArgResults global, ArgResults command) async {
    if (command['dry-run'] == true && command['force'] == true) {
      throw UsageException(
          '--dry-run cannot be combined with --force.', _usage);
    }
    if (command['auto'] == true &&
        (command['skip-validation'] == true ||
            command['ignore-warnings'] == true)) {
      throw UsageException(
        '--skip-validation and --ignore-warnings are only supported for single-package publish.',
        _usage,
      );
    }
    final directory = _directory(global);
    final host = _resolveHost(global, directory);
    await _ensurePubToken(global, host);
    if (command['auto'] == true) {
      final plan = _workspace.prepare(
        directory,
        host,
        targets: command.rest,
      );
      _printPublishPlan(plan);
      if (command['dry-run'] == true) {
        _stdout.writeln('Dry run complete; source files were not changed.');
        return 0;
      }
      final staging =
          await Directory.systemTemp.createTemp('ppub_auto_');
      try {
        for (final name in plan.order) {
          final output = p.join(staging.path, name);
          await materializePackage(
            plan.packages[name]!,
            output,
            plan.rewrittenPubspecs[name]!,
          );
          _stdout
              .writeln('Publishing $name ${plan.packages[name]!.version} ...');
          final code = await _runPublishProcess(
            output,
            force: command['force'] as bool,
          );
          if (code != 0) return code;
        }
      } finally {
        await staging.delete(recursive: true);
      }
      return 0;
    }

    final package = _packageAt(directory);
    final staging =
        await Directory.systemTemp.createTemp('ppub_publish_');
    try {
      final output = p.join(staging.path, package.name);
      await materializePackage(
        package,
        output,
        rewritePublishTarget(package.pubspecSource, host),
      );
      _stdout.writeln(
        'Publishing ${package.name} ${package.version} to $host from a temporary copy.',
      );
      return await _runPublishProcess(
        output,
        dryRun: command['dry-run'] as bool,
        force: command['force'] as bool,
        skipValidation: command['skip-validation'] as bool,
        ignoreWarnings: command['ignore-warnings'] as bool,
      );
    } finally {
      await staging.delete(recursive: true);
    }
  }

  Future<int> _prepare(ArgResults global, ArgResults command) async {
    final directory = _directory(global);
    final host = _resolveHost(global, directory);
    final plan = _workspace.prepare(
      directory,
      host,
      targets: command.rest,
    );
    _printPublishPlan(plan);
    if (command['dry-run'] == true) {
      _stdout.writeln('Dry run complete; no files were written.');
      return 0;
    }
    final rawOutput = command['output'] as String? ??
        p.join(directory, '.ppub', 'prepare');
    final output =
        Directory(p.normalize(p.absolute(_workingDirectory, rawOutput)));
    if (output.existsSync()) {
      throw FileSystemException(
        'Prepare output already exists; choose an empty --output directory.',
        output.path,
      );
    }
    await output.create(recursive: true);
    for (final name in plan.order) {
      await materializePackage(
        plan.packages[name]!,
        p.join(output.path, name),
        plan.rewrittenPubspecs[name]!,
      );
    }
    _stdout
        .writeln('Prepared ${plan.order.length} package(s) in ${output.path}.');
    return 0;
  }

  Future<int> _mcp(ArgResults global, ArgResults command) async {
    final serverVal = command['server'] as String?;
    final host = serverVal != null ? _parseHost(serverVal) : _commandHost(global, command);
    final tokenVal = command['token'] as String?;
    final credential = tokenVal ?? _credential(global, host);
    if (credential == null || credential.isEmpty) {
      throw UsageException(
        'No token is available for $host. Run `ppub login $host` first.',
        _usage,
      );
    }
    final client = RegistryClient(host: host, token: credential);
    _stderr.writeln('Ppub MCP connected to $host over stdio.');
    try {
      await PrivatePubMcpServer(
        client: client,
        output: _stdout,
        errors: _stderr,
      ).run();
      return 0;
    } finally {
      client.close();
    }
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
        'Usage: ppub versions <package>',
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
        'Usage: ppub compare <package> <from> <to>',
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
    final sdk = requestedSdk == 'auto'
        ? (_inspector.isFlutterProject(directory) ? 'flutter' : 'dart')
        : requestedSdk;
    final environment = Map<String, String>.from(_environment)
      ..remove('PUB_HOSTED_URL');
    
    final useFvm = _useFvm;
    final String executable;
    final List<String> processArguments;
    if (useFvm) {
      executable = _fvmExecutable;
      processArguments = <String>[sdk, ...arguments];
    } else {
      executable = sdk;
      processArguments = arguments;
    }

    _stderr.writeln('Running: $executable ${processArguments.join(' ')}');
    if (_hasConfiguredHost(global)) {
      _stderr.writeln(
        'Note: PUB_HOSTED_URL is not forwarded to Pub. Declare private '
        'dependencies with `hosted:` in pubspec.yaml so public packages keep '
        'using pub.dev.',
      );
    }
    final process = await Process.start(
      executable,
      processArguments,
      workingDirectory: directory,
      environment: environment,
      mode: ProcessStartMode.inheritStdio,
      runInShell: Platform.isWindows,
    );
    return process.exitCode;
  }

  Uri _commandHost(
    ArgResults global,
    ArgResults command, {
    bool requireLogin = true,
  }) {
    if (command.rest.length > 1) {
      throw UsageException('Expected at most one registry URL.', _usage);
    }
    final positional = command.rest.singleOrNull;
    final configured =
        global['host'] as String? ?? _environment['PUB_HOSTED_URL'];
    final raw = positional ?? configured;
    if (raw != null && raw.trim().isNotEmpty) return _parseHost(raw);
    final defaultHost = _credentials.defaultHost;
    if (defaultHost != null) return defaultHost;
    throw UsageException(
      requireLogin
          ? 'Registry URL is required. Example: ppub login https://pub.company.dev'
          : 'Registry URL is required.',
      _usage,
    );
  }

  String? _credential(ArgResults global, Uri host) {
    final tokenEnv = global['token-env'] as String;
    final environmentToken = _environment[tokenEnv];
    if (environmentToken != null && environmentToken.isNotEmpty) {
      return environmentToken;
    }
    return _credentials.get(host)?.token;
  }

  Future<void> _ensurePubToken(ArgResults global, Uri host) async {
    final tokenEnv = global['token-env'] as String;
    final environmentToken = _environment[tokenEnv];
    if (environmentToken != null && environmentToken.isNotEmpty) {
      await _pubTokens.registerEnvironment(host, tokenEnv);
      return;
    }
    final credential = _credentials.get(host);
    if (credential == null) {
      throw UsageException(
        'No token is available for $host. Run `ppub login $host` first.',
        _usage,
      );
    }
    await _pubTokens.registerToken(host, credential.token);
  }

  WorkspacePackage _packageAt(String directory) {
    final normalized = p.normalize(p.absolute(directory));
    final packages = _workspace.discover(normalized);
    for (final package in packages.values) {
      if (p.equals(package.directory, normalized)) return package;
    }
    throw ProjectException('No publishable pubspec.yaml found in $normalized.');
  }

  Future<int> _runPublishProcess(
    String directory, {
    bool dryRun = false,
    bool force = false,
    bool skipValidation = false,
    bool ignoreWarnings = false,
  }) async {
    final arguments = <String>[
      'pub',
      'publish',
      '--directory',
      directory,
      if (dryRun) '--dry-run',
      if (force) '--force',
      if (skipValidation) '--skip-validation',
      if (ignoreWarnings) '--ignore-warnings',
    ];
    final useFvm = _useFvm;
    final String executable;
    final List<String> processArguments;
    if (useFvm) {
      executable = _fvmExecutable;
      processArguments = <String>['dart', ...arguments];
    } else {
      executable = 'dart';
      processArguments = arguments;
    }
    _stderr.writeln(
      'Running: $executable ${processArguments.join(' ')} (temporary package copy)',
    );
    final environment = Map<String, String>.from(_environment)
      ..remove('PUB_HOSTED_URL');
    final process = await Process.start(
      executable,
      processArguments,
      workingDirectory: directory,
      environment: environment,
      mode: ProcessStartMode.inheritStdio,
      runInShell: Platform.isWindows,
    );
    return process.exitCode;
  }

  void _printPublishPlan(WorkspacePlan plan) {
    _stdout.writeln('Registry: ${plan.host}');
    _stdout.writeln('Publish order (dependencies first):');
    for (var index = 0; index < plan.order.length; index++) {
      final name = plan.order[index];
      _stdout.writeln(
        '  ${index + 1}. $name ${plan.packages[name]!.version}',
      );
    }
  }

  RegistryClient _client(ArgResults global, Uri host) {
    return _registryClientFactory(host, _credential(global, host));
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
    if (File(p.join(directory, 'pubspec.yaml')).existsSync()) {
      final urls = _inspector.hostedUrls(directory);
      if (urls.length == 1) return normalizeRegistryHost(urls.single);
    }
    final defaultHost = _credentials.defaultHost;
    if (defaultHost != null) return defaultHost;
    throw UsageException(
      'Private registry is required. Use --host or run `ppub login`.',
      _usage,
    );
  }

  bool _hasConfiguredHost(ArgResults result) {
    final option = result['host'] as String?;
    return (option != null && option.trim().isNotEmpty) ||
        (_environment['PUB_HOSTED_URL']?.trim().isNotEmpty ?? false);
  }

  bool get _useFvm =>
      _environment['USE_FVM'] == 'true' ||
      (_environment['FVM_EXECUTABLE']?.trim().isNotEmpty == true);

  String get _fvmExecutable =>
      _environment['FVM_EXECUTABLE']?.trim().isNotEmpty == true
          ? _environment['FVM_EXECUTABLE']!.trim()
          : 'fvm';

  Uri _parseHost(String raw) {
    final uri = Uri.tryParse(raw);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      throw FormatException('Invalid private registry URL: $raw');
    }
    return normalizeRegistryHost(uri);
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

  int _config(ArgResults global, ArgResults command) {
    final subcommand = command.command;
    if (subcommand == null || subcommand.name == 'show') {
      final defaultHost = _credentials.defaultHost;
      if (defaultHost != null) {
        _stdout.writeln('Default registry server: $defaultHost');
      } else {
        _stdout.writeln('No default registry server configured.');
      }
      return 0;
    }
    if (subcommand.name == 'set-server') {
      if (subcommand.rest.isEmpty) {
        throw UsageException('Usage: ppub config set-server <host>', _usage);
      }
      final host = _parseHost(subcommand.rest.first);
      _credentials.setDefault(host);
      _stdout.writeln('Default registry server set to: $host');
      return 0;
    }
    throw UsageException('Unknown subcommand: ${subcommand.name}', _usage);
  }

  Future<int> _add(ArgResults global, ArgResults command) async {
    if (command.rest.isEmpty) {
      throw UsageException('Usage: ppub add [<section>:]<package>[:<descriptor>] ...', _usage);
    }
    final directory = _directory(global);
    final pubspecFile = File(p.join(directory, 'pubspec.yaml'));
    if (!pubspecFile.existsSync()) {
      throw ProjectException('No pubspec.yaml found in $directory.');
    }

    final host = _resolveHost(global, directory);
    final client = _client(global, host);
    try {
      final content = pubspecFile.readAsStringSync();
      final editor = YamlEditor(content);

      for (final arg in command.rest) {
        final parts = arg.split(':');
        String section = 'dependencies';
        String package;
        String? descriptor;

        if (parts.length >= 3) {
          section = _mapSection(parts[0]);
          package = parts[1];
          descriptor = parts.sublist(2).join(':');
        } else if (parts.length == 2) {
          if (_isValidSectionPrefix(parts[0])) {
            section = _mapSection(parts[0]);
            package = parts[1];
          } else {
            package = parts[0];
            descriptor = parts[1];
          }
        } else {
          package = parts[0];
        }

        if (descriptor == null) {
          _stdout.writeln('Resolving latest version for $package from $host ...');
          try {
            final registryPackage = await client.getPackage(package);
            final latest = registryPackage.latest(includePrereleases: false);
            if (latest == null) {
              throw RegistryException('No active version found for package $package.');
            }
            descriptor = '^${latest.version}';
          } catch (e) {
            _stdout.writeln('Could not resolve latest version for $package: $e. Defaulting to any.');
            descriptor = 'any';
          }
        }

        // Add to pubspec using YamlEditor
        editor.update([section, package], {
          'hosted': host.toString(),
          'version': descriptor,
        });
        _stdout.writeln('Added $package: $descriptor to $section.');
      }

      pubspecFile.writeAsStringSync(editor.toString());
      _stdout.writeln('Updated pubspec.yaml successfully.');

      // Run pub get
      _stdout.writeln('Running pub get ...');
      final code = await _runPub(global, ['get']);
      return code;
    } finally {
      client.close();
    }
  }

  bool _isValidSectionPrefix(String prefix) {
    return const ['dev', 'override', 'dependencies', 'dev_dependencies', 'dependency_overrides'].contains(prefix);
  }

  String _mapSection(String prefix) {
    switch (prefix) {
      case 'dev':
      case 'dev_dependencies':
        return 'dev_dependencies';
      case 'override':
      case 'dependency_overrides':
        return 'dependency_overrides';
      default:
        return 'dependencies';
    }
  }

  Future<int> _global(ArgResults global, ArgResults command) async {
    final subcommand = command.command;
    if (subcommand == null) {
      throw UsageException('Usage: ppub global <activate|deactivate> [arguments]', _usage);
    }
    if (subcommand.name == 'activate') {
      if (subcommand.rest.isEmpty) {
        throw UsageException('Usage: ppub global activate <package>', _usage);
      }
      final directory = _directory(global);
      final host = _resolveHost(global, directory);
      await _ensurePubToken(global, host);
      return await _runPub(global, [
        'global',
        'activate',
        '--hosted-url',
        host.toString(),
        ...subcommand.rest,
      ]);
    } else if (subcommand.name == 'deactivate') {
      if (subcommand.rest.isEmpty) {
        throw UsageException('Usage: ppub global deactivate <package>', _usage);
      }
      return await _runPub(global, [
        'global',
        'deactivate',
        ...subcommand.rest,
      ]);
    } else {
      throw UsageException('Unknown subcommand: ${subcommand.name}', _usage);
    }
  }

  String get _usage => '''
Inspect and update packages in a private Dart/Flutter Pub registry.

Usage: ppub [global options] <command> [arguments]

Global options:
${_parser.usage}

Commands:
  login [url]                    OAuth login in the system browser
  logout                         Remove stored credentials
  setup                          Register the stored token with Dart Pub
  publish                        Smart publish without editing pubspec.yaml
  publish --auto [packages...]   Publish a monorepo in dependency order
  prepare [packages...]          Generate hosted monorepo package copies
  mcp                            Start the private package MCP stdio server
  config                         Show or change default server
  add <package>                  Add hosted dependencies to pubspec.yaml
  global                         Manage globally-installed packages
  check                          Compare project locks with registry versions
  versions <package>             List versions published in the registry
  compare <package> <from> <to>  Compare SDK and dependency constraints
  outdated                       Run fvm dart/flutter pub outdated
  upgrade [packages...]          Run fvm dart/flutter pub upgrade

Examples:
  ppub login https://pub.company.dev
  ppub config set-server https://pub.company.dev
  ppub add dev:company_ui:^1.2.0
  ppub publish
  ppub -C packages publish --auto
  ppub -C packages prepare --dry-run
  ppub mcp
  ppub check
  ppub versions company_ui
  ppub compare company_ui 1.2.0 2.0.0
  ppub outdated --transitive
  ppub upgrade
  ppub upgrade --major-versions --dry-run
''';
}
