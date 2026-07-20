import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:private_pub_cli/private_pub_cli.dart';
import 'package:test/test.dart';

void main() {
  late Directory temp;
  late IOSink output;
  late IOSink errors;
  late File outputFile;
  late File errorFile;

  setUp(() async {
    temp = Directory.systemTemp.createTempSync('private_pub_cli_command_');
    outputFile = File('${temp.path}/stdout.txt');
    errorFile = File('${temp.path}/stderr.txt');
    output = outputFile.openWrite();
    errors = errorFile.openWrite();
  });

  tearDown(() async {
    await output.close();
    await errors.close();
    temp.deleteSync(recursive: true);
  });

  test('check infers an explicit hosted URL and ignores public dependencies',
      () async {
    const host = 'http://127.0.0.1:43210';
    File('${temp.path}/pubspec.yaml').writeAsStringSync('''
name: sample
environment:
  sdk: ^3.3.0
dependencies:
  company_ui:
    hosted: $host
    version: ^1.0.0
  http: ^1.0.0
''');
    File('${temp.path}/pubspec.lock').writeAsStringSync('''
packages:
  company_ui:
    dependency: direct main
    description:
      name: company_ui
      url: $host
    source: hosted
    version: "1.0.0"
''');

    final requested = <String>[];
    final httpClient = MockClient((request) async {
      requested.add(request.url.path);
      return http.Response(
        jsonEncode({
          'name': 'company_ui',
          'versions': [
            {
              'version': '1.0.0',
              'pubspec': {'name': 'company_ui'},
            },
            {
              'version': '1.1.0',
              'pubspec': {'name': 'company_ui'},
            },
          ],
        }),
        HttpStatus.ok,
      );
    });

    final exitCode = await PrivatePubCli(
      stdout: output,
      stderr: errors,
      environment: const {},
      workingDirectory: temp.path,
      credentialStore: CredentialStore(
        filePath: '${temp.path}/credentials.json',
      ),
      registryClientFactory: (host, token) => RegistryClient(
        host: host,
        token: token,
        httpClient: httpClient,
      ),
    ).run(['check', '--fail-on-outdated']).timeout(const Duration(seconds: 5));
    await output.flush();
    await errors.flush();

    expect(exitCode, 1, reason: errorFile.readAsStringSync());
    expect(requested, ['/api/packages/company_ui']);
    expect(outputFile.readAsStringSync(), contains('update available'));
  });
}
