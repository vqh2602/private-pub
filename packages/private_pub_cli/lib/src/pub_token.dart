import 'dart:convert';
import 'dart:io';

import 'credentials.dart';
import 'registry_client.dart';

final class PubTokenRegistrar {
  const PubTokenRegistrar({this.fvmExecutable = 'fvm'});

  final String fvmExecutable;

  Future<void> registerToken(Uri rawHost, String token) async {
    final host = normalizeRegistryHost(rawHost);
    final process = await Process.start(
      fvmExecutable,
      ['dart', 'pub', 'token', 'add', host.toString()],
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
            ? 'fvm dart pub token add failed with exit code $code.'
            : 'fvm dart pub token add failed: $processOutput',
      );
    }
  }

  Future<void> registerEnvironment(Uri rawHost, String variableName) async {
    final host = normalizeRegistryHost(rawHost);
    if (!RegExp(r'^[A-Za-z_][A-Za-z0-9_]*$').hasMatch(variableName)) {
      throw const FormatException('Invalid environment variable name.');
    }
    final result = await Process.run(
      fvmExecutable,
      [
        'dart',
        'pub',
        'token',
        'add',
        host.toString(),
        '--env-var',
        variableName,
      ],
      runInShell: Platform.isWindows,
    );
    if (result.exitCode != 0) {
      final output = '${result.stdout}${result.stderr}'.trim();
      throw RegistryException(
        output.isEmpty
            ? 'fvm dart pub token add failed with exit code ${result.exitCode}.'
            : 'fvm dart pub token add failed: $output',
      );
    }
  }
}
