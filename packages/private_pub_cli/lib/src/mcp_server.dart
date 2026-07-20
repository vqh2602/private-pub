import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'registry_client.dart';

/// Small MCP stdio server exposing authenticated private-registry discovery
/// and source-reading tools. Protocol messages are the only stdout output.
final class PrivatePubMcpServer {
  PrivatePubMcpServer({
    required RegistryClient client,
    Stream<List<int>>? input,
    IOSink? output,
    IOSink? errors,
  })  : _client = client,
        _input = input ?? stdin,
        _output = output ?? stdout,
        _errors = errors ?? stderr;

  final RegistryClient _client;
  final Stream<List<int>> _input;
  final IOSink _output;
  final IOSink _errors;
  bool _exitRequested = false;

  Future<void> run() async {
    await for (final line
        in _input.transform(utf8.decoder).transform(const LineSplitter())) {
      if (line.trim().isEmpty) continue;
      try {
        final decoded = jsonDecode(line);
        if (decoded is! Map) {
          _writeError(null, -32600, 'Request must be a JSON object.');
          continue;
        }
        await _handle(Map<String, Object?>.from(decoded));
        if (_exitRequested) break;
      } on FormatException catch (error) {
        _writeError(null, -32700, 'Invalid JSON: ${error.message}');
      } on Object catch (error, stackTrace) {
        _errors.writeln('ppub mcp: $error\n$stackTrace');
      }
    }
  }

  Future<void> _handle(Map<String, Object?> request) async {
    final id = request['id'];
    final method = request['method'];
    if (request['jsonrpc'] != '2.0' || method is! String) {
      if (id != null) _writeError(id, -32600, 'Invalid JSON-RPC request.');
      return;
    }
    if (method == 'notifications/initialized') return;
    if (method == 'notifications/cancelled') return;
    if (method == 'exit') {
      _exitRequested = true;
      return;
    }
    if (id == null) return;

    switch (method) {
      case 'initialize':
        final params = request['params'];
        final requestedVersion =
            params is Map && params['protocolVersion'] is String
                ? params['protocolVersion'] as String
                : '2025-03-26';
        _writeResult(id, {
          'protocolVersion': requestedVersion,
          'capabilities': {
            'tools': {'listChanged': false},
          },
          'serverInfo': {
            'name': 'private-pub-registry',
            'version': '0.1.0',
          },
        });
        return;
      case 'ping':
        _writeResult(id, <String, Object?>{});
        return;
      case 'tools/list':
        _writeResult(id, {'tools': _tools});
        return;
      case 'tools/call':
        await _callTool(id, request['params']);
        return;
      case 'shutdown':
        _writeResult(id, <String, Object?>{});
        return;
      default:
        _writeError(id, -32601, 'Method not found: $method');
    }
  }

  Future<void> _callTool(Object id, Object? rawParams) async {
    if (rawParams is! Map || rawParams['name'] is! String) {
      _writeError(id, -32602, 'tools/call requires a tool name.');
      return;
    }
    final name = rawParams['name'] as String;
    final arguments = rawParams['arguments'] is Map
        ? Map<String, Object?>.from(rawParams['arguments'] as Map)
        : <String, Object?>{};
    try {
      final Object result;
      switch (name) {
        case 'private_pub_search':
        case 'ppub_search':
          final query = _requiredString(arguments, 'query');
          final rawLimit = arguments['limit'];
          final limit = rawLimit is int ? rawLimit.clamp(1, 50) : 10;
          result = await _client.search(query, limit: limit);
          break;
        case 'private_pub_get_package':
        case 'ppub_get_package':
          result = await _client.getPackageDetail(
            _requiredString(arguments, 'name'),
          );
          break;
        case 'private_pub_list_files':
        case 'ppub_list_files':
          result = await _client.getPackageFiles(
            _requiredString(arguments, 'name'),
            _requiredString(arguments, 'version'),
          );
          break;
        case 'private_pub_read_file':
        case 'ppub_read_file':
          result = await _client.getPackageFile(
            _requiredString(arguments, 'name'),
            _requiredString(arguments, 'version'),
            _requiredString(arguments, 'path'),
          );
          break;
        default:
          _writeError(id, -32602, 'Unknown tool: $name');
          return;
      }
      _writeResult(id, {
        'content': [
          {
            'type': 'text',
            'text': const JsonEncoder.withIndent('  ').convert(result),
          },
        ],
      });
    } on FormatException catch (error) {
      _writeError(id, -32602, error.message);
    } on RegistryException catch (error) {
      _writeResult(id, {
        'isError': true,
        'content': [
          {'type': 'text', 'text': error.message},
        ],
      });
    }
  }

  String _requiredString(Map<String, Object?> arguments, String name) {
    final value = arguments[name];
    if (value is! String || value.trim().isEmpty || value.length > 512) {
      throw FormatException('Argument "$name" must be a non-empty string.');
    }
    return value.trim();
  }

  void _writeResult(Object id, Object result) => _write({
        'jsonrpc': '2.0',
        'id': id,
        'result': result,
      });

  void _writeError(Object? id, int code, String message) => _write({
        'jsonrpc': '2.0',
        'id': id,
        'error': {'code': code, 'message': message},
      });

  void _write(Object value) => _output.writeln(jsonEncode(value));
}

const _tools = [
  {
    'name': 'ppub_search',
    'description':
        'Search packages in the authenticated private Dart registry.',
    'inputSchema': {
      'type': 'object',
      'properties': {
        'query': {'type': 'string'},
        'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50},
      },
      'required': ['query'],
      'additionalProperties': false,
    },
  },
  {
    'name': 'ppub_get_package',
    'description':
        'Read package metadata, versions, SDK constraints, and dependencies.',
    'inputSchema': {
      'type': 'object',
      'properties': {
        'name': {'type': 'string'},
      },
      'required': ['name'],
      'additionalProperties': false,
    },
  },
  {
    'name': 'ppub_list_files',
    'description': 'List source files for a private package version.',
    'inputSchema': {
      'type': 'object',
      'properties': {
        'name': {'type': 'string'},
        'version': {'type': 'string'},
      },
      'required': ['name', 'version'],
      'additionalProperties': false,
    },
  },
  {
    'name': 'ppub_read_file',
    'description': 'Read one text source file from a private package version.',
    'inputSchema': {
      'type': 'object',
      'properties': {
        'name': {'type': 'string'},
        'version': {'type': 'string'},
        'path': {'type': 'string'},
      },
      'required': ['name', 'version', 'path'],
      'additionalProperties': false,
    },
  },
  {
    'name': 'private_pub_search',
    'description':
        'Search packages in the authenticated private Dart registry (legacy).',
    'inputSchema': {
      'type': 'object',
      'properties': {
        'query': {'type': 'string'},
        'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50},
      },
      'required': ['query'],
      'additionalProperties': false,
    },
  },
  {
    'name': 'private_pub_get_package',
    'description':
        'Read package metadata, versions, SDK constraints, and dependencies (legacy).',
    'inputSchema': {
      'type': 'object',
      'properties': {
        'name': {'type': 'string'},
      },
      'required': ['name'],
      'additionalProperties': false,
    },
  },
  {
    'name': 'private_pub_list_files',
    'description': 'List source files for a private package version (legacy).',
    'inputSchema': {
      'type': 'object',
      'properties': {
        'name': {'type': 'string'},
        'version': {'type': 'string'},
      },
      'required': ['name', 'version'],
      'additionalProperties': false,
    },
  },
  {
    'name': 'private_pub_read_file',
    'description': 'Read one text source file from a private package version (legacy).',
    'inputSchema': {
      'type': 'object',
      'properties': {
        'name': {'type': 'string'},
        'version': {'type': 'string'},
        'path': {'type': 'string'},
      },
      'required': ['name', 'version', 'path'],
      'additionalProperties': false,
    },
  },
];
