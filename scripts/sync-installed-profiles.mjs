#!/usr/bin/env node
/**
 * After a build, refresh the copy of this plugin that each DSH profile has installed.
 *
 * `pnpm run build` deletes and recreates lib/, so the files the profile installed are left behind:
 * they were hard-linked at install time and pnpm considers the dependency unchanged, so it will not
 * re-link them (verified: a plain install, --force and a re-add all leave the old inode in place).
 * Only removing the installed directory and re-running `pnpm install` re-creates the links. That is
 * what this does, for every profile whose package.json depends on this package.
 *
 * With no matching profile (CI, a fresh clone, another machine) it is a no-op and exits 0, so it can
 * sit at the end of the build without affecting the release gate.
 *
 * Usage: node scripts/sync-installed-profiles.mjs [--check] [--home <DSH_HOME>]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const repo = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const check = argv.includes('--check')
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const home = resolve(flag('--home') ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const profilesDir = join(home, 'profiles')
const name = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).name

/** Profiles that declare this package as a dependency or as a bundle. */
function installedProfiles() {
  const found = []
  let entries
  try { entries = readdirSync(profilesDir, { withFileTypes: true }) } catch { return found }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const manifest = join(profilesDir, entry.name, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      const asDependency = pkg.dependencies?.[name] !== undefined
      const asBundle = Array.isArray(pkg.dsh?.profile?.bundles) && pkg.dsh.profile.bundles.includes(name)
      if (asDependency || asBundle) found.push(join(profilesDir, entry.name))
    } catch { /* an unreadable manifest is not fatal */ }
  }
  return found
}

/**
 * Break hard links in a directory or file by rewriting any file that has nlink > 1.
 *
 * On Windows, pnpm creates hard links for local file: dependencies. When nlink > 1 and the NTFS 64-bit
 * FileId exceeds Number.MAX_SAFE_INTEGER (2^53), Node's `stat.ino` loses precision and different
 * files collide on the same ino. When `node-tar` (used by `npm pack` / `npm publish`) encounters
 * nlink > 1, it deduplicates by dev:ino and wrongly treats colliding files as hard links (typeflag '1',
 * 0-byte payload). npm registry rejects tarballs with hard links (415 Hard link is not allowed).
 * Breaking the hard links keeps nlink = 1 on both sides and prevents npm publish failures.
 */
function breakHardlinks(target) {
  try {
    const stat = statSync(target)
    if (stat.isDirectory()) {
      let entries
      try { entries = readdirSync(target, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        breakHardlinks(join(target, entry.name))
      }
    } else if (stat.isFile() && stat.nlink > 1) {
      const content = readFileSync(target)
      unlinkSync(target)
      writeFileSync(target, content, { mode: stat.mode })
    }
  } catch { /* ignore permission or missing path errors */ }
}

function ensureRepoHasNoHardlinks() {
  for (const item of ['lib', 'src', 'scripts', 'cordis.patch.yml', 'README.md', 'LICENSE', 'package.json']) {
    breakHardlinks(join(repo, item))
  }
}

const profiles = installedProfiles()
if (profiles.length === 0) {
  ensureRepoHasNoHardlinks()
  console.log('sync-installed-profiles: no profile installs ' + name + ' (nothing to refresh)')
  process.exit(0)
}

let refreshed = 0
for (const profile of profiles) {
  const installed = join(profile, 'node_modules', name)
  if (!existsSync(installed)) {
    console.log('sync-installed-profiles: ' + profile + ' declares ' + name + ' but has no installed copy; run pnpm install there')
    continue
  }
  if (check) {
    console.log('sync-installed-profiles: would refresh ' + installed)
    continue
  }
  try {
    // Removing the entry is what makes pnpm re-create it from the freshly built files.
    rmSync(installed, { recursive: true, force: true })
    execFileSync('cmd', ['/c', 'pnpm install'], { cwd: profile, stdio: 'ignore' })
    breakHardlinks(installed)
    refreshed += 1
    console.log('sync-installed-profiles: refreshed ' + installed)
  } catch (error) {
    // The build itself succeeded; a failed refresh is reported loudly but does not fail it.
    console.log('! sync-installed-profiles: could not refresh ' + installed + ' — ' + (error instanceof Error ? error.message : String(error)))
  }
}
ensureRepoHasNoHardlinks()
console.log('sync-installed-profiles: ' + refreshed + ' of ' + profiles.length + ' profile(s) refreshed')

