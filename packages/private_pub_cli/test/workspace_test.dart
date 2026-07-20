import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:private_pub_cli/private_pub_cli.dart';
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

void main() {
  late Directory temp;

  setUp(() =>
      temp = Directory.systemTemp.createTempSync('private_pub_workspace_'));
  tearDown(() => temp.deleteSync(recursive: true));

  void writePackage(
    String name,
    String version, {
    String dependencies = '',
  }) {
    final directory = Directory(p.join(temp.path, name))..createSync();
    File(p.join(directory.path, 'pubspec.yaml')).writeAsStringSync('''
name: $name
version: $version
environment:
  sdk: ^3.3.0
${dependencies.isEmpty ? '' : 'dependencies:\n$dependencies'}
''');
  }

  test('plans transitive monorepo packages in topological order', () {
    writePackage('foundation', '1.2.0');
    writePackage(
      'components',
      '2.0.0',
      dependencies: '''
  foundation:
    path: ../foundation
''',
    );
    writePackage(
      'application',
      '3.0.0',
      dependencies: '''
  components: ^2.0.0
''',
    );
    final componentsSource = File(
      p.join(temp.path, 'components', 'pubspec.yaml'),
    ).readAsStringSync();

    final plan = const WorkspacePlanner().prepare(
      temp.path,
      Uri.parse('https://pub.company.dev/'),
      targets: const ['application'],
    );

    expect(plan.order, ['foundation', 'components', 'application']);
    final components = loadYaml(plan.rewrittenPubspecs['components']!) as Map;
    expect(components['publish_to'], 'https://pub.company.dev');
    expect(components['dependencies']['foundation'], {
      'hosted': 'https://pub.company.dev',
      'version': '^1.2.0',
    });
    final application = loadYaml(plan.rewrittenPubspecs['application']!) as Map;
    expect(application['dependencies']['components'], {
      'hosted': 'https://pub.company.dev',
      'version': '^2.0.0',
    });
    expect(
      File(p.join(temp.path, 'components', 'pubspec.yaml')).readAsStringSync(),
      componentsSource,
      reason: 'planning must never edit the checkout',
    );
  });

  test('reports dependency cycles before publishing anything', () {
    writePackage(
      'alpha',
      '1.0.0',
      dependencies: '''
  beta:
    path: ../beta
''',
    );
    writePackage(
      'beta',
      '1.0.0',
      dependencies: '''
  alpha:
    path: ../alpha
''',
    );

    expect(
      () => const WorkspacePlanner().prepare(
        temp.path,
        Uri.parse('https://pub.company.dev'),
      ),
      throwsA(
        isA<ProjectException>().having(
          (error) => error.message,
          'message',
          contains('dependency cycle'),
        ),
      ),
    );
  });

  test('materializes a clean copy with generated pubspec only', () async {
    writePackage('sample', '1.0.0');
    Directory(p.join(temp.path, 'sample', '.dart_tool')).createSync();
    File(p.join(temp.path, 'sample', '.dart_tool', 'secret'))
        .writeAsStringSync('x');
    Directory(p.join(temp.path, 'sample', '.fvm')).createSync();
    File(p.join(temp.path, 'sample', '.fvm', 'secret'))
        .writeAsStringSync('y');
    File(p.join(temp.path, 'sample', 'lib.dart'))
        .writeAsStringSync('const value = 1;');
    final package = const WorkspacePlanner().discover(temp.path)['sample']!;
    final output = p.join(temp.path, 'output', 'sample');

    await materializePackage(
      package,
      output,
      rewritePublishTarget(
        package.pubspecSource,
        Uri.parse('https://pub.company.dev'),
      ),
    );

    expect(File(p.join(output, 'lib.dart')).existsSync(), isTrue);
    expect(Directory(p.join(output, '.dart_tool')).existsSync(), isFalse);
    expect(Directory(p.join(output, '.fvm')).existsSync(), isFalse);
    expect(
      loadYaml(File(p.join(output, 'pubspec.yaml')).readAsStringSync())[
          'publish_to'],
      'https://pub.company.dev',
    );
    expect(
      loadYaml(File(p.join(package.directory, 'pubspec.yaml'))
          .readAsStringSync())['publish_to'],
      isNull,
    );
  });
}
