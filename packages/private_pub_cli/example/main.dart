import 'dart:io';
import 'package:private_pub_cli/private_pub_cli.dart';

void main() async {
  print('Private Pub CLI API Example');

  // 1. Create a registry client.
  final client = RegistryClient(
    host: Uri.parse('http://localhost:4000'),
    token: 'demo-admin-token',
  );

  print('Registry host: ${client.host}');

  // 2. Inspect dependencies in the current directory.
  const inspector = DependencyInspector();
  try {
    final dependencies = inspector.inspect(Directory.current.path);
    print('Found ${dependencies.length} dependencies:');
    for (final dep in dependencies) {
      print(' - ${dep.name}: constraint=${dep.constraint}, current=${dep.current}');
    }
  } on ProjectException catch (e) {
    print('Failed to inspect directory: $e');
  }

  // 3. Create a workspace planner.
  const planner = WorkspacePlanner();
  try {
    final plan = planner.prepare(Directory.current.path, client.host);
    print('Generated plan with ${plan.order.length} packages to publish:');
    print('Publish order: ${plan.order.join(' -> ')}');
  } on ProjectException catch (e) {
    print('Failed to prepare workspace: $e');
  }
}
