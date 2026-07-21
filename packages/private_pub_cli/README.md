# ppub (private_pub_cli)

`ppub` (packaged as `private_pub_cli`) logs in, configures, publishes, searches, compares, and upgrades Dart or Flutter packages against a private Hosted Pub Repository. It includes source-preserving smart publish, topological monorepo publishing, and an MCP stdio server for AI tools.

The `outdated` and `upgrade` commands delegate dependency resolution to the installed Dart or Flutter SDK. They deliberately do **not** forward a global `PUB_HOSTED_URL`: Pub has no fallback from a private host to pub.dev, so a global value would make public dependencies fail resolution. Declare the private host on each private dependency instead. Lockfiles, Pub workspaces, authentication configured with `fvm dart pub token`, and the Pub version solver therefore keep their standard behavior.

FVM is optional. By default, every Dart and Flutter SDK subprocess started by this CLI is executed using the system-level `dart` or `flutter` commands. If FVM is desired, set the `USE_FVM=true` environment variable. Set `FVM_EXECUTABLE` to point to a custom FVM binary if needed.

## Install

```bash
# Using system Dart:
dart pub global activate private_pub_cli

# Or using FVM:
fvm dart pub global activate private_pub_cli
```

During local development:

```bash
# Using system Dart:
dart pub global activate --source path .

# Or using FVM:
fvm dart pub global activate --source path .
```

This installs the `ppub` executable globally.

## Default Server Configuration

You can configure a default private registry server so you do not need to specify it in every command:

```bash
ppub config set-server https://pub.company.dev
ppub config show
```

## Login and configure

Use browser-based OAuth Authorization Code + PKCE. Login also registers the token with the Dart SDK by default:

```bash
ppub login https://pub.company.dev
# Or login to the configured default server:
ppub login

# If you are running in an environment without a browser:
ppub login --no-browser

# If you already have a static Bearer token or PAT:
ppub login --key your-api-token

# Re-register token after installing a new Dart SDK:
ppub setup

# Logout:
ppub logout --server https://pub.company.dev
# Or logout from all servers:
ppub logout --all
```

Credentials are stored separately from Dart Pub so the CLI can select among registries and power MCP. On macOS/Linux the default file is `~/.config/ppub/credentials.json` with mode `0600`. For CI, keep the secret in an environment variable:

```bash
ppub --host https://pub.company.dev setup --env-var PRIVATE_PUB_TOKEN
```

## Add Dependency

Easily add private registry hosted packages to your `pubspec.yaml`:

```bash
ppub add company_ui
# Specify version constraint:
ppub add company_ui:^1.2.0
# Add to dev_dependencies:
ppub add dev:company_ui
# Add to dependency_overrides:
ppub add override:company_ui
```

If no version constraint is specified, `ppub` queries the private server to resolve and append the latest version.

## Registry selection

Pass `--host` before private metadata commands (`check`, `versions`, and `compare`). This affects only `ppub`, not `fvm dart pub` or `fvm flutter pub` commands started directly from the same shell:

```bash
ppub --host https://pub.company.dev check
ppub --host https://pub.company.dev versions company_ui
```

Avoid exporting `PUB_HOSTED_URL` in a shell that also runs normal Pub commands: an exported environment variable is inherited by every child process, including direct `fvm dart pub` and `fvm flutter pub` invocations.

For a project that uses both pub.dev and a private registry, pin the registry on every private package in `pubspec.yaml`:

```yaml
dependencies:
  company_ui:
    hosted: https://pub.company.dev
    version: ^1.0.0
  http: ^1.0.0 # resolved from pub.dev
```

Direct metadata commands (`check`, `versions`, and `compare`) can use a bearer token without putting the secret in shell history:

```bash
export PRIVATE_PUB_TOKEN='your-token'
ppub versions company_ui
```

Use `--token-env NAME` if your token is stored in another environment variable. The CLI refuses to send bearer tokens over plain HTTP except to loopback hosts; use HTTPS for every shared or remote registry.

## Commands

### Smart publish

`publish` writes `publish_to` only into a clean temporary copy and delegates validation/upload to the installed Dart SDK. The source `pubspec.yaml` is never changed:

```bash
ppub -C packages/company_ui publish
ppub -C packages/company_ui publish --dry-run
ppub -C packages/company_ui publish --force
```

For monorepos, `--auto` discovers packages, builds the dependency graph, selects the transitive closure of optional target packages, converts local path/workspace dependencies to hosted constraints, and publishes dependencies first. Cycles and path dependencies outside the workspace fail before upload:

```bash
ppub -C . publish --auto
ppub -C . publish --auto app_package shared_package
ppub -C . publish --auto --dry-run
ppub -C . prepare --output /tmp/publish-ready
```

`prepare` materializes publish-ready copies for inspection or another CI stage; it does not edit the checkout. Its default output is `.ppub/prepare`. For `publish --auto`, `--dry-run` prints and validates the dependency/rewrite plan without invoking Dart Pub; single-package `publish --dry-run` runs Dart's full publish validation.

### MCP for AI tools

Expose authenticated search, package metadata, file listing, and source reading over MCP stdio:

```json
{
  "mcpServers": {
    "ppub": {
      "command": "ppub",
      "args": ["mcp"]
    }
  }
}
```

Or connect manually/override host:
```bash
ppub mcp --server https://pub.company.dev --token your-pat
```

### Global packages activation

Activate and manage global packages from the private registry:

```bash
ppub global activate my_cli_tool
ppub global deactivate my_cli_tool
```

### Check a project

```bash
ppub check
ppub check --prereleases
ppub check --fail-on-outdated
```

The table compares each direct dependency's locked version and constraint with the newest active version available from the private registry. Use `--fail-on-outdated` in CI.

### List and compare registry versions

```bash
ppub versions company_ui
ppub versions company_ui --retracted
ppub compare company_ui 1.8.0 2.0.0
```

`compare` classifies the SemVer change and compares publication state, minimum SDK constraints, and dependency constraints in the two published pubspecs.

### Run Pub's dependency solver

```bash
ppub outdated
ppub outdated --transitive --json
ppub upgrade
ppub upgrade http company_ui
ppub upgrade --major-versions
ppub upgrade --major-versions --dry-run
```

The CLI automatically chooses `flutter pub` (or `fvm flutter pub` if FVM is configured) when the project has an SDK dependency on Flutter; otherwise it uses `dart pub` (or `fvm dart pub`). Override detection with `--sdk=dart` or `--sdk=flutter`.

Use `-C path/to/project` to run against another project directory.

## Exit codes

- `0`: command succeeded
- `1`: outdated packages found when `--fail-on-outdated` is enabled
- `64`: invalid command or missing configuration
- `65`: malformed version or URL
- `66`: invalid Dart/Flutter project
- `69`: registry or process failure

## Security

Prefer `dart pub token add` (or `fvm dart pub token add` if using FVM) for `outdated` and `upgrade`. For metadata commands, pass the name of an environment variable with `--token-env`; never put a token directly in command arguments or commit it to a pubspec.
