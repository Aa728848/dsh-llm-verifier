#!/usr/bin/env node
/**
 * Enforce the repository layout rules.
 *
 * A folder holds subfolders plus files of one extension, and at most one Markdown file that
 * explains it. `docs/` is the exception the rule needs: a documentation folder holds Markdown
 * files, and its `README.md` is the index rather than a second kind of file.
 *
 * Also refuses `.ts` outside `src/`, `test/` and `scripts/`, and test files outside `test/`.
 * Usage: node scripts/check-layout.mjs
 */
import { readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const SKIP = new Set(['node_modules', '.git', 'lib', 'dist', '.codegraph'])
const problems = []

/**
 * Every file under a directory, as repo-relative POSIX paths.
 * @param dir - absolute directory to walk.
 * @returns the files inside it.
 */
function files(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) out.push(...files(join(dir, entry.name)))
      continue
    }
    out.push(join(dir, entry.name))
  }
  return out
}

for (const dir of walkDirs(repo)) {
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => !e.isDirectory() && !SKIP.has(e.name))
  if (entries.length === 0) continue
  const label = relative(repo, dir).replaceAll('\\', '/') || '.'
  const markdown = entries.filter((e) => extname(e.name) === '.md')
  const others = entries.filter((e) => extname(e.name) !== '.md')
  const extensions = new Set(others.map((e) => extname(e.name)))

  if (extensions.size > 1) {
    problems.push(`${label}: mixes ${[...extensions].sort().join(', ')}`)
    continue
  }
  const isDocsFolder = markdown.length > 0 && others.length === 0
  if (!isDocsFolder && markdown.length > 1) {
    problems.push(`${label}: ${markdown.length} Markdown files beside ${[...extensions][0]}; keep one README.md`)
  }
  if (!isDocsFolder && markdown.length === 1 && markdown[0].name !== 'README.md') {
    problems.push(`${label}: the only Markdown file must be README.md, found ${markdown[0].name}`)
  }
}

for (const file of files(repo)) {
  const label = relative(repo, file).replaceAll('\\', '/')
  const parts = label.split('/')
  const root = parts[0]
  const isTest = label.endsWith('.test.ts')
  if (isTest && root !== 'test') problems.push(`${label}: tests live under test/<domain>/`)
  if (parts.length === 1) continue
  if (!isTest && ['.ts', '.tsx'].includes(extname(file)) && !['src', 'test', 'scripts'].includes(root)) {
    problems.push(`${label}: TypeScript belongs in src/`)
  }
}

/** Every directory below a root, skipping the directories the walk ignores. */
function walkDirs(root) {
  const out = []
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP.has(entry.name)) continue
      const path = join(dir, entry.name)
      out.push(path)
      visit(path)
    }
  }
  visit(root)
  return out
}

if (problems.length > 0) {
  console.error('check-layout: the tree breaks the layout rules')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('check-layout: every folder holds one kind of file')


