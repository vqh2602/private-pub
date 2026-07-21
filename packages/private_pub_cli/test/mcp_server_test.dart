import 'dart:convert';
import 'dart:io';

import 'package:private_pub_cli/private_pub_cli.dart';
import 'package:test/test.dart';

void main() {
  late Directory temp;
  late HttpServer registry;

  setUp(() async {
    temp = Directory.systemTemp.createTempSync('private_pub_mcp_');
    registry = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  });

  tearDown(() async {
    await registry.close(force: true);
    temp.deleteSync(recursive: true);
  });

  test('serves MCP initialize, tool discovery, and authenticated search',
      () async {
    final requested = <HttpRequest>[];
    final requestTask = () async {
      final request = await registry.first;
      requested.add(request);
      request.response
        ..statusCode = HttpStatus.ok
        ..headers.contentType = ContentType.json
        ..write(
          jsonEncode({
            'items': [
              {'name': 'company_ui', 'latestVersion': '1.2.0'},
            ],
            'total': 1,
            'page': 1,
            'limit': 5,
          }),
        );
      await request.response.close();
    }();
    final outputFile = File('${temp.path}/stdout.jsonl');
    final errorFile = File('${temp.path}/stderr.txt');
    final output = outputFile.openWrite();
    final errors = errorFile.openWrite();
    final messages = [
      {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}},
      {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
      {
        'jsonrpc': '2.0',
        'id': 3,
        'method': 'tools/call',
        'params': {
          'name': 'private_pub_search',
          'arguments': {'query': 'company', 'limit': 5},
        },
      },
      {'jsonrpc': '2.0', 'method': 'exit'},
    ];
    final input = Stream<List<int>>.value(
      utf8.encode('${messages.map(jsonEncode).join('\n')}\n'),
    );
    final client = RegistryClient(
      host: Uri.parse('http://127.0.0.1:${registry.port}'),
      token: 'test-token',
    );

    await PrivatePubMcpServer(
      client: client,
      input: input,
      output: output,
      errors: errors,
    ).run();
    await requestTask;
    await output.close();
    await errors.close();
    client.close();

    final responses = outputFile
        .readAsLinesSync()
        .map((line) => jsonDecode(line) as Map<String, Object?>)
        .toList();
    expect(responses, hasLength(3));
    expect((responses[0]['result'] as Map)['serverInfo'], {
      'name': 'private-pub-registry',
      'version': '0.1.1',
    });
    expect((responses[1]['result'] as Map)['tools'], hasLength(8));
    final toolResult = (responses[2]['result'] as Map)['content'] as List;
    expect((toolResult.single as Map)['text'], contains('company_ui'));
    expect(requested.single.uri.path, '/v1/search');
    expect(requested.single.uri.queryParameters, {
      'q': 'company',
      'limit': '5',
      'page': '1',
    });
    expect(
        requested.single.headers.value('authorization'), 'Bearer test-token');
    expect(errorFile.readAsStringSync(), isEmpty);
  });
}
