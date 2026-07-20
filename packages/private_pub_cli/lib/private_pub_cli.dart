/// A Dart CLI client and MCP server for private Hosted Pub registries.
///
/// Contains classes and utilities to authenticate, inspect dependencies, and
/// publish packages to private registries.
library;

export 'src/cli.dart' show PrivatePubCli, RegistryClientFactory;
export 'src/credentials.dart';
export 'src/dependency_inspector.dart';
export 'src/mcp_server.dart';
export 'src/oauth_login.dart';
export 'src/pub_token.dart';
export 'src/registry_client.dart';
export 'src/workspace.dart';
