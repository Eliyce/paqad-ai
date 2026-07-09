// Parses the JSON emitted by `npm pack --json`, tolerating the output-shape
// change npm shipped in v12 (issue #332). npm <= 11 prints a top-level array of
// package manifests; npm >= 12 prints an object keyed by package name. Both
// carry the same per-package manifest, so we normalise to the first manifest.
//
//   npm <= 11:  [ { "id": "paqad-ai@1.48.0", "files": [ ... ] } ]
//   npm >= 12:  { "paqad-ai": { "id": "paqad-ai@1.48.0", "files": [ ... ] } }
//
// The Release job runs `npm install -g npm@latest`, so a surprise major bump of
// npm must never crash the publish-time E2E again. Keep this shape-agnostic.

export interface PackManifest {
  id?: string;
  files: Array<{ path: string }>;
}

export function parsePackManifest(stdout: string): PackManifest {
  const parsed: unknown = JSON.parse(stdout);
  const manifest = Array.isArray(parsed)
    ? (parsed[0] as PackManifest | undefined)
    : (Object.values(parsed as Record<string, PackManifest>)[0] as PackManifest | undefined);

  if (manifest === undefined || !Array.isArray(manifest.files)) {
    throw new Error(`Unexpected 'npm pack --json' output shape: ${stdout.slice(0, 200)}`);
  }

  return manifest;
}
