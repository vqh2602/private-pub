import 'dart:convert';
import 'dart:io';

import 'credentials.dart';
import 'registry_client.dart';

/// Registers access tokens with the local Dart SDK using FVM.
final class PubTokenRegistrar {
  /// Creates a new [PubTokenRegistrar] instance.
  const PubTokenRegistrar({
    this.fvmExecutable = 'fvm',
    this.useFvm = false,
  });

  /// The executable name/path for FVM (defaults to 'fvm').
  final String fvmExecutable;

  /// Whether to use FVM for executing pub commands.
  final bool useFvm;

  /// Registers a [token] for the given [rawHost] with the Dart SDK.
  Future<void> registerToken(Uri rawHost, String token) async {
    final host = normalizeRegistryHost(rawHost);
    final String executable;
    final List<String> arguments;
    if (useFvm) {
      executable = fvmExecutable;
      arguments = ['dart', 'pub', 'token', 'add', host.toString()];
    } else {
      executable = 'dart';
      arguments = ['pub', 'token', 'add', host.toString()];
    }
    final process = await Process.start(
      executable,
      arguments,
      runInShell: Platform.isWindows,
    );
    final stdoutTask = process.stdout.transform(utf8.decoder).join();
    final stderrTask = process.stderr.transform(utf8.decoder).join();
    process.stdin.writeln(token);
    await process.stdin.close();
    final code = await process.exitCode;
    final processOutput = '${await stdoutTask}${await stderrTask}'.trim();
    if (code != 0) {
      throw RegistryException(
        processOutput.isEmpty
            ? '${useFvm ? 'fvm ' : ''}dart pub token add failed with exit code $code.'
            : '${useFvm ? 'fvm ' : ''}dart pub token add failed: $processOutput',
      );
    }
  }

  /// Registers an environment variable name for authentication with the given [rawHost].
  Future<void> registerEnvironment(Uri rawHost, String variableName) async {
    final host = normalizeRegistryHost(rawHost);
    if (!RegExp(r'^[A-Za-z_][A-Za-z0-9_]*$').hasMatch(variableName)) {
      throw const FormatException('Invalid environment variable name.');
    }
    final String executable;
    final List<String> arguments;
    if (useFvm) {
      executable = fvmExecutable;
      arguments = [
        'dart',
        'pub',
        'token',
        'add',
        host.toString(),
        '--env-var',
        variableName,
      ];
    } else {
      executable = 'dart';
      arguments = [
        'pub',
        'token',
        'add',
        host.toString(),
        '--env-var',
        variableName,
      ];
    }
    final result = await Process.run(
      executable,
      arguments,
      runInShell: Platform.isWindows,
    );
    if (result.exitCode != 0) {
      final output = '${result.stdout}${result.stderr}'.trim();
      throw RegistryException(
        output.isEmpty
            ? '${useFvm ? 'fvm ' : ''}dart pub token add failed with exit code ${result.exitCode}.'
            : '${useFvm ? 'fvm ' : ''}dart pub token add failed: $output',
      );
    }
  }
}
