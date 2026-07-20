import 'dart:io';

import 'package:private_pub_cli/private_pub_cli.dart';
import 'package:test/test.dart';

void main() {
  late Directory temp;

  setUp(() =>
      temp = Directory.systemTemp.createTempSync('private_pub_credentials_'));
  tearDown(() => temp.deleteSync(recursive: true));

  test('stores normalized multi-registry credentials and a default host', () {
    final file = '${temp.path}/config/credentials.json';
    final store = CredentialStore(filePath: file);
    store.save(
      host: Uri.parse('https://pub.company.dev/'),
      token: 'first-token',
      username: 'developer',
    );
    store.save(
      host: Uri.parse('https://packages.example.com'),
      token: 'second-token',
      makeDefault: false,
    );

    expect(store.defaultHost, Uri.parse('https://pub.company.dev'));
    expect(
        store.get(Uri.parse('https://pub.company.dev/'))?.token, 'first-token');
    expect(store.list(), hasLength(2));
    if (!Platform.isWindows) {
      expect(FileStat.statSync(file).mode & 0x1ff, 0x180); // 0600
    }
  });
}
