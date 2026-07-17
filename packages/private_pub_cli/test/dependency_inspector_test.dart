import 'dart:io';

import 'package:private_pub_cli/private_pub_cli.dart';
import 'package:test/test.dart';

void main() {
  late Directory temp;

  setUp(() => temp = Directory.systemTemp.createTempSync('private_pub_cli_'));
  tearDown(() => temp.deleteSync(recursive: true));

  test('reads hosted dependencies and locked versions', () {
    File('${temp.path}/pubspec.yaml').writeAsStringSync('''
name: sample
environment:
  sdk: ^3.3.0
dependencies:
  company_ui:
    hosted: https://pub.company.dev
    version: ^1.0.0
  http: ^1.0.0
  local_package:
    path: ../local_package
  flutter:
    sdk: flutter
dev_dependencies:
  test: any
''');
    File('${temp.path}/pubspec.lock').writeAsStringSync('''
packages:
  company_ui:
    dependency: direct main
    description:
      name: company_ui
      url: https://pub.company.dev
    source: hosted
    version: "1.2.0"
  http:
    dependency: direct main
    description:
      name: http
      url: https://pub.dev
    source: hosted
    version: "1.1.0"
''');

    final dependencies = const DependencyInspector().inspect(temp.path);

    expect(
      dependencies.map((item) => item.name),
      ['company_ui', 'http', 'flutter', 'test'],
    );
    expect(dependencies.first.current.toString(), '1.2.0');
    expect(dependencies.first.hostedUrl.toString(), 'https://pub.company.dev');
    expect(dependencies[2].constraint, 'sdk:flutter');
    expect(const DependencyInspector().isFlutterProject(temp.path), isTrue);
  });
}
