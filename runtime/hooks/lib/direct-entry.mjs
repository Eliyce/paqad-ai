// Shared, realpath-safe "is this module the process entry point?" guard (issue #636, bug 2).
//
// A hook is invoked through the symlinked install (~/.paqad-ai/current -> the package runtime, or
// ${CLAUDE_PLUGIN_ROOT}/runtime for the plugin), and macOS also aliases /tmp -> /private/tmp, so the
// raw `import.meta.url === \`file://${process.argv[1]}\`` compare MISSES and the hook silently
// no-ops (the #303 gotcha); on Windows and on paths with spaces it never matches at all. Comparing
// real paths through pathToFileURL(realpathSync(argv1)) is symlink-, space- and Windows-safe. Every
// hook entry guard imports this one function so the broken raw form cannot creep back (guard test).

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * True when `importMetaUrl` (the caller's `import.meta.url`) names the process entry point `argv1`
 * (default `process.argv[1]`), compared as real file URLs. Any error (missing path, unreadable
 * target) yields false, so importing a hook module for a test runs nothing.
 */
export function isDirectEntry(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) {
    return false;
  }
  try {
    return importMetaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}
