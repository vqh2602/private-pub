import 'dart:convert';
import 'dart:io';

import 'package:private_pub_cli/private_pub_cli.dart';
import 'package:test/test.dart';

void main() {
  late Directory temp;
  late HttpServer server;
  late IOSink output;
  late IOSink errors;
  late File outputFile;
  late File errorFile;

  setUp(() async {
    temp = Directory.systemTemp.createTempSync('private_pub_cli_command_');
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    outputFile = File('${temp.path}/stdout.txt');
    errorFile = File('${temp.path}/stderr.txt');
    output = outputFile.openWrite();
    errors = errorFile.openWrite();
  });

  tearDown(() async {
    await output.close();
    await errors.close();
    await server.close(force: true);
    temp.deleteSync(recursive: true);
  });

  test('check infers an explicit hosted URL and ignores public dependencies',
      () async {
    final host = 'http://127.0.0.1:${server.port}';
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
    final serverTask = () async {
      final request = await server.first;
      requested.add(request.uri.path);
      request.response
        ..statusCode = HttpStatus.ok
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({
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
        }));
      await request.response.close();
    }();

    final exitCode = await PrivatePubCli(
      stdout: output,
      stderr: errors,
      environment: const {},
      workingDirectory: temp.path,
    ).run(['check', '--fail-on-outdated']);
    await serverTask;
    await output.flush();

    expect(exitCode, 1);
    expect(requested, ['/api/packages/company_ui']);
    expect(outputFile.readAsStringSync(), contains('update available'));
  });
}
