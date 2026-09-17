#!/usr/bin/env node
/**
 * Refuse to run `typecheck:local` against a stale local harness build.
 *
 * `tsconfig.local.json` maps every `@deepseek-ai/*` import onto `../deepseek-harness/<pkg>/lib/types`,
 * which is build output, not source. That directory is only as new as the last harness build, so a
 * `git pull` in the harness leaves this check green while it typechecks an older host — which is how
 * the 0.1.6 release went unnoticed here while the declarations still came from 0.1.5. The probe
 * compares each mapped declaration file against the newest source file of its package and fails
 * when the source moved on without a rebuild.
 *
 * Set `DSH_VERIFIER_SKIP_HARNESS_CHECK=1` to bypass the probe for a one-off run.
 * Usage: node scripts/check-harness-types.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const REBUILD = [
  'The paths above are the ones tsconfig.local.json maps; either place the checkout there (a directory',
  'junction works) or repoint those paths. Then rebuild it from the harness checkout:',
  '  pnpm install',
  '  node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json',
  '  node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.client.json',
  '',
  'The client face needs the harness optional dependencies installed, and stays stale without them.',
]

if (process.env.DSH_VERIFIER_SKIP_HARNESS_CHECK === '1') {
  console.log('check-harness-types: skipped by DSH_VERIFIER_SKIP_HARNESS_CHECK')
  process.exit(0)
}

/**
 * Every package root that `tsconfig.local.json` maps a bare specifier onto, taken from the
 * `<pkgRoot>/lib/types/...` target text rather than from a second hand-kept list.
 * @returns the absolute package roots, deduplicated.
 */
function mappedPackageRoots() {
  const config = JSON.parse(readFileSync(join(repo, 'tsconfig.local.json'), 'utf8'))
  const roots = new Set()
  for (const targets of Object.values(config.compilerOptions?.paths ?? {})) {
    const target = Array.isArray(targets) ? targets[0] : undefined
    if (typeof target !== 'string') continue
    // tsconfig writes these with forward slashes on every platform, so the marker matches that
    // spelling rather than the platform separator.
    const marker = 'lib/types/'
    const cut = target.replaceAll('\\', '/').lastIndexOf(marker)
    if (cut === -1) continue
    roots.add(resolve(repo, target.slice(0, cut)))
  }
  return roots
}

/**
 * Newest modification time under a directory.
 * @param root - directory to walk.
 * @returns the newest file mtime in milliseconds, or undefined when no file is readable.
 */
function newestSourceTime(root) {
  let newest
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      const time = statSync(path).mtimeMs
      if (newest === undefined || time > newest) newest = time
    }
  }
  walk(root)
  return newest
}

const roots = mappedPackageRoots()
const problems = []
for (const packageRoot of roots) {
  const label = relative(repo, packageRoot).replaceAll('\\', '/')
  if (!existsSync(packageRoot)) {
    problems.push(`${label}: the harness checkout is missing`)
    continue
  }
  const declaration = join(packageRoot, 'lib', 'types', 'index.d.ts')
  if (!existsSync(declaration)) {
    problems.push(`${label}: declarations were never built`)
    continue
  }
  const source = newestSourceTime(join(packageRoot, 'src'))
  if (source !== undefined && source > statSync(declaration).mtimeMs) {
    problems.push(`${label}: source is newer than the built declarations`)
  }
}

if (problems.length > 0) {
  console.error('check-harness-types: `typecheck:local` would not check the harness checked out here.')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('')
  console.error('Neither failure is one TypeScript reports: a `paths` target that does not resolve falls')
  console.error('through to ordinary resolution, so @deepseek-ai/* quietly comes from node_modules — the')
  console.error('npm-pinned release — and the command looks green while it validates the wrong host.')
  console.error('')
  for (const line of REBUILD) console.error(line)
  process.exit(1)
}

console.log(`check-harness-types: all ${roots.size} mapped packages are newer than their sources`)
