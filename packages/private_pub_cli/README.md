# private_pub_cli

`private_pub_cli` logs in, configures, publishes, searches, compares, and
upgrades Dart or Flutter packages against this private Hosted Pub Repository.
It includes source-preserving smart publish, topological monorepo publishing,
and an MCP stdio server for AI tools.

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

## Login and configure

Use browser-based OAuth Authorization Code + PKCE. Login also registers the
token with the Dart SDK by default:

```bash
private_pub login https://pub.company.dev
private_pub setup # re-register after installing a new Dart SDK
private_pub logout https://pub.company.dev
```

Credentials are stored separately from Dart Pub so the CLI can select among
registries and power MCP. On macOS/Linux the default file is
`~/.config/private_pub/credentials.json` with mode `0600`. For CI, keep the
secret in an environment variable:

```bash
private_pub --host https://pub.company.dev setup --env-var PRIVATE_PUB_TOKEN
```

## Registry selection

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

### Smart publish

`publish` writes `publish_to` only into a clean temporary copy and delegates
validation/upload to the installed Dart SDK. The source `pubspec.yaml` is never
changed:

```bash
private_pub -C packages/company_ui publish
private_pub -C packages/company_ui publish --dry-run
private_pub -C packages/company_ui publish --force
```

For monorepos, `--auto` discovers packages, builds the dependency graph,
selects the transitive closure of optional target packages, converts local
path/workspace dependencies to hosted constraints, and publishes dependencies
first. Cycles and path dependencies outside the workspace fail before upload:

```bash
private_pub -C . publish --auto
private_pub -C . publish --auto app_package shared_package
private_pub -C . publish --auto --dry-run
private_pub -C . prepare --output /tmp/publish-ready
```

`prepare` materializes publish-ready copies for inspection or another CI stage;
it does not edit the checkout. Its default output is `.private_pub/prepare`.
For `publish --auto`, `--dry-run` prints and validates the dependency/rewrite
plan without invoking Dart Pub; single-package `publish --dry-run` runs Dart's
full publish validation.

### MCP for AI tools

After login, expose authenticated search, package metadata, file listing, and
source reading over MCP stdio:

```json
{
  "mcpServers": {
    "private-pub": {
      "command": "private_pub",
      "args": ["mcp"]
    }
  }
}
```

Pass global `--host https://pub.company.dev` before `mcp` to pin a non-default
login. Protocol JSON is emitted only on stdout; diagnostics go to stderr.

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
