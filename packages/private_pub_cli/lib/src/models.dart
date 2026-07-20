import 'package:pub_semver/pub_semver.dart';

/// Represents a package version retrieved from a private Hosted Pub registry.
final class RegistryVersion {
  /// Creates a new [RegistryVersion] instance.
  RegistryVersion({
    required this.version,
    required this.pubspec,
    required this.retracted,
    this.published,
  });

  /// The version number.
  final Version version;

  /// The parsed contents of the version's `pubspec.yaml`.
  final Map<String, Object?> pubspec;

  /// Whether this version has been retracted.
  final bool retracted;

  /// Optional publish timestamp.
  final DateTime? published;
}

/// Represents a package and all its versions retrieved from a private Hosted Pub registry.
final class RegistryPackage {
  /// Creates a new [RegistryPackage] instance.
  RegistryPackage({required this.name, required List<RegistryVersion> versions})
      : versions = List.unmodifiable(versions);

  /// The name of the package.
  final String name;

  /// The list of all versions of this package.
  final List<RegistryVersion> versions;

  /// Returns the active (non-retracted) versions sorted descending by version number.
  List<RegistryVersion> get activeVersions =>
      versions.where((item) => !item.retracted).toList()
        ..sort((a, b) => b.version.compareTo(a.version));

  /// Finds the latest active version, optionally including pre-releases.
  RegistryVersion? latest({bool includePrereleases = false}) {
    return activeVersions.cast<RegistryVersion?>().firstWhere(
          (item) => includePrereleases || !item!.version.isPreRelease,
          orElse: () => null,
        );
  }
}

/// Defines the category of dependency under which a package is declared.
enum DependencyKind {
  /// Declared under dependencies.
  dependency,

  /// Declared under dev_dependencies.
  devDependency,

  /// Declared under dependency_overrides.
  override
}

/// Represents a declared project dependency.
final class ProjectDependency {
  /// Creates a new [ProjectDependency] instance.
  const ProjectDependency({
    required this.name,
    required this.constraint,
    required this.kind,
    this.current,
    this.hostedUrl,
  });

  /// The name of the dependency.
  final String name;

  /// The constraint string.
  final String constraint;

  /// The kind of dependency (dependency, devDependency, override).
  final DependencyKind kind;

  /// The locked current version, if resolved and present.
  final Version? current;

  /// The hosted URL of the registry, if hosted externally.
  final Uri? hostedUrl;
}
