# private_pub_cli

`private_pub_cli` inspects, compares, and upgrades Dart or Flutter dependencies
against a private Hosted Pub Repository. It works with registries that implement
the Hosted Pub Repository API V2, including Unpub and Constellation.

The `outdated` and `upgrade` commands delegate dependency resolution to the
installed Dart or Flutter SDK. They deliberately do **not** forward a global
`PUB_HOSTED_URL`: Pub has no fallback from a private host to pub.dev, so a
global value would make public dependencies fail resolution. Declare the
private host on each private dependency instead. Lockfiles, Pub workspaces,
authentication configured with `dart pub token`, and the Pub version solver
therefore keep their standard behavior.

## Install

```bash
dart pub global activate private_pub_cli
```

During local development:

```bash
dart pub global activate --source path .
```

## Configure

Pass `--host` before private metadata commands (`check`, `versions`, and
`compare`). This affects only `private_pub`, not `dart pub` or `flutter pub`
commands started directly from the same shell:

```bash
private_pub --host https://pub.company.dev check
private_pub --host https://pub.company.dev versions company_ui
```

Avoid exporting `PUB_HOSTED_URL` in a shell that also runs normal Pub commands:
an exported environment variable is inherited by every child process, including
direct `dart pub` and `flutter pub` invocations.

For a project that uses both pub.dev and a private registry, pin the registry
on every private package in `pubspec.yaml`:

```yaml
dependencies:
  company_ui:
    hosted: https://pub.company.dev
    version: ^1.0.0
  http: ^1.0.0 # resolved from pub.dev
```

For a registry protected by a Dart Pub token, configure the SDK once:

```bash
dart pub token add https://pub.company.dev
```

Direct metadata commands (`check`, `versions`, and `compare`) can use a bearer
token without putting the secret in shell history:

```bash
export PRIVATE_PUB_TOKEN='your-token'
private_pub versions company_ui
```

Use `--token-env NAME` if your token is stored in another environment variable.
The CLI refuses to send bearer tokens over plain HTTP except to loopback hosts;
use HTTPS for every shared or remote registry.

## Commands

### Check a project

```bash
private_pub check
private_pub check --prereleases
private_pub check --fail-on-outdated
```

The table compares each direct dependency's locked version and constraint with
the newest active version available from the private registry. Use
`--fail-on-outdated` in CI.

### List and compare registry versions

```bash
private_pub versions company_ui
private_pub versions company_ui --retracted
private_pub compare company_ui 1.8.0 2.0.0
```

`compare` classifies the SemVer change and compares publication state, minimum
SDK constraints, and dependency constraints in the two published pubspecs.

### Run Pub's dependency solver

```bash
private_pub outdated
private_pub outdated --transitive --json
private_pub upgrade
private_pub upgrade http company_ui
private_pub upgrade --major-versions
private_pub upgrade --major-versions --dry-run
```

The CLI automatically chooses `flutter pub` when the project has an SDK
dependency on Flutter; otherwise it uses `dart pub`. Override detection with
`--sdk=dart` or `--sdk=flutter`.

Use `-C path/to/project` to run against another project directory.

## Exit codes

- `0`: command succeeded
- `1`: outdated packages found when `--fail-on-outdated` is enabled
- `64`: invalid command or missing configuration
- `65`: malformed version or URL
- `66`: invalid Dart/Flutter project
- `69`: registry or process failure

## Security

Prefer `dart pub token add` for `outdated` and `upgrade`. For metadata commands,
pass the name of an environment variable with `--token-env`; never put a token
directly in command arguments or commit it to a pubspec.
