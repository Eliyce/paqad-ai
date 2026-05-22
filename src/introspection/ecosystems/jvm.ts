import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

export const jvmParser: EcosystemParser = {
  ecosystem: 'jvm',
  packageManager: 'gradle',
  manifestFiles: ['build.gradle', 'build.gradle.kts', 'pom.xml'],
  lockfileFiles: ['gradle.lockfile'],
  parseManifest(content: string, filename: string): ParsedManifest {
    if (filename === 'pom.xml') {
      return {
        ecosystem: 'jvm',
        packages: Array.from(
          content.matchAll(
            /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?(?:<version>([^<]+)<\/version>)?[\s\S]*?<\/dependency>/g,
          ),
        ).map((match) => ({
          name: `${match[1]}:${match[2]}`,
          constraint: match[3],
          isDev: false,
        })),
      };
    }

    return {
      ecosystem: 'jvm',
      packages: Array.from(
        content.matchAll(
          /(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?["']([^:"']+):([^:"']+):([^"')]+)["']\)?/g,
        ),
      ).map((match) => ({
        name: `${match[1]}:${match[2]}`,
        constraint: match[3],
        isDev: match[0].startsWith('test'),
      })),
    };
  },
  parseLockfile(content: string): ParsedLockfile {
    return {
      ecosystem: 'jvm',
      packages: content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
        .map((line) => {
          const [name, version] = line.split('=');
          if (!name || !version) {
            return null;
          }
          return { name, version };
        })
        .filter((entry): entry is { name: string; version: string } => entry !== null),
    };
  },
};
