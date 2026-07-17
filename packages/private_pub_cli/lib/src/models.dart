import 'package:pub_semver/pub_semver.dart';

final class RegistryVersion {
  RegistryVersion({
    required this.version,
    required this.pubspec,
    required this.retracted,
    this.published,
  });

  final Version version;
  final Map<String, Object?> pubspec;
  final bool retracted;
  final DateTime? published;
}

final class RegistryPackage {
  RegistryPackage({required this.name, required List<RegistryVersion> versions})
      : versions = List.unmodifiable(versions);

  final String name;
  final List<RegistryVersion> versions;

  List<RegistryVersion> get activeVersions =>
      versions.where((item) => !item.retracted).toList()
        ..sort((a, b) => b.version.compareTo(a.version));

  RegistryVersion? latest({bool includePrereleases = false}) {
    return activeVersions.cast<RegistryVersion?>().firstWhere(
          (item) => includePrereleases || !item!.version.isPreRelease,
          orElse: () => null,
        );
  }
}

enum DependencyKind { dependency, devDependency, override }

final class ProjectDependency {
  const ProjectDependency({
    required this.name,
    required this.constraint,
    required this.kind,
    this.current,
    this.hostedUrl,
  });

  final String name;
  final String constraint;
  final DependencyKind kind;
  final Version? current;
  final Uri? hostedUrl;
}
