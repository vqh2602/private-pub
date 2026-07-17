import 'dart:io';

import 'package:private_pub_cli/private_pub_cli.dart';

Future<void> main(List<String> arguments) async {
  exitCode = await PrivatePubCli().run(arguments);
}
