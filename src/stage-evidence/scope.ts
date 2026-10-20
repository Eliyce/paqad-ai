import { isAbsolute, relative } from 'pathe';

function toRelativePosix(targetPath: string, projectRoot?: string): string {
  const rel =
    projectRoot && isAbsolute(targetPath) ? relative(projectRoot, targetPath) : targetPath;
  return rel.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isFrameworkInternalPath(targetPath: string, projectRoot?: string): boolean {
  const p = toRelativePosix(targetPath, projectRoot);
  return p === '' || p === '.paqad' || p.startsWith('.paqad/') || p.startsWith('../');
}

export function isDocumentationPath(targetPath: string, projectRoot?: string): boolean {
  const p = toRelativePosix(targetPath, projectRoot);
  if (p === 'docs' || p.startsWith('docs/')) return true;
  if (/\.(md|mdx|markdown|mdown|rst|adoc)$/i.test(p)) return true;
  if (/^(readme|changelog|contributing|license|licence|notice|authors)(\.|$)/i.test(p)) return true;
  return false;
}

const HOST_AGENT_CONFIG_DIRS = [
  '.claude',
  '.codex',
  '.gemini',
  '.junie',
  '.cursor',
  '.windsurf',
  '.continue',
  '.aider',
  '.aiassistant',
  '.ai',
] as const;

const HOST_AGENT_CONFIG_FILES = ['.windsurfrules'] as const;

export function isHostAgentConfigPath(targetPath: string, projectRoot?: string): boolean {
  const p = toRelativePosix(targetPath, projectRoot);
  if (HOST_AGENT_CONFIG_FILES.includes(p as (typeof HOST_AGENT_CONFIG_FILES)[number])) {
    return true;
  }
  return HOST_AGENT_CONFIG_DIRS.some((dir) => p === dir || p.startsWith(`${dir}/`));
}

export function isFeatureDevEdit(targetPath: string | undefined, projectRoot?: string): boolean {
  if (!targetPath) return true;
  if (isFrameworkInternalPath(targetPath, projectRoot)) return false;
  if (isHostAgentConfigPath(targetPath, projectRoot)) return false;
  if (isDocumentationPath(targetPath, projectRoot)) return false;
  return true;
}

export function changeIsFeatureDev(files: readonly string[], projectRoot?: string): boolean {
  return files.some((file) => isFeatureDevEdit(file, projectRoot));
}
