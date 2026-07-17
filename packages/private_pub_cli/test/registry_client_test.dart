import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:private_pub_cli/private_pub_cli.dart';
import 'package:test/test.dart';

void main() {
  test('parses and sorts Hosted Pub V2 metadata', () async {
    final mock = MockClient((request) async {
      expect(request.url.toString(), 'https://pub.company.dev/api/packages/ui');
      expect(request.headers['authorization'], 'Bearer secret');
      return http.Response(
          '''
{
  "name": "ui",
  "versions": [
    {"version":"1.0.0","pubspec":{"name":"ui"},"published":"2026-01-01T00:00:00Z"},
    {"version":"2.0.0-dev.1","pubspec":{"name":"ui"}},
    {"version":"1.2.0","pubspec":{"name":"ui"},"retracted":true},
    {"version":"1.1.0","pubspec":{"name":"ui"}}
  ]
}
''',
          200,
          headers: {'content-type': 'application/vnd.pub.v2+json'});
    });
    final client = RegistryClient(
      host: Uri.parse('https://pub.company.dev/'),
      token: 'secret',
      httpClient: mock,
    );

    final package = await client.getPackage('ui');

    expect(package.latest()!.version.toString(), '1.1.0');
    expect(package.latest(includePrereleases: true)!.version.toString(),
        '2.0.0-dev.1');
    expect(package.activeVersions.length, 3);
  });
}
