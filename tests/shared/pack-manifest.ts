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
