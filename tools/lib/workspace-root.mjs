import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Self-locating workspace root for `sdkwork-specs/tools/*`.
 *
 * A tool must not default to one machine's checkout path: the workspace is
 * relocatable, and `DEPENDENCY_MANAGEMENT_SPEC.md` section 1 forbids binding a
 * source path to a machine-specific absolute location. Deriving the default
 * from this module's own location also makes a tool behave the same whether it
 * is invoked from the workspace root, from `sdkwork-specs`, or by absolute path.
 *
 * Layout this resolves against:
 *   <workspace-root>/sdkwork-specs/tools/lib/workspace-root.mjs
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `<workspace-root>/sdkwork-specs` */
export const SPECS_ROOT = path.resolve(HERE, '..', '..');

/** `<workspace-root>` — the default `--workspace` target. */
export const DEFAULT_WORKSPACE_ROOT = path.resolve(SPECS_ROOT, '..');

/**
 * Resolve an explicit `--workspace` value, falling back to the self-located
 * workspace root rather than a hardcoded checkout path.
 */
export function resolveWorkspaceRoot(explicit) {
  return path.resolve(explicit ?? DEFAULT_WORKSPACE_ROOT);
}

/**
 * Render a file path relative to the workspace root with POSIX separators.
 *
 * This replaces the former `file.replace('<workspace-root>/', '')` idiom, which
 * both hardcoded one machine's checkout and silently produced an absolute path
 * whenever the workspace lived anywhere else.
 */
export function toWorkspaceRelative(workspaceRoot, file) {
  return path.relative(workspaceRoot, file).replace(/\\/g, '/');
}
