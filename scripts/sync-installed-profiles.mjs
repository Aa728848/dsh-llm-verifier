#!/usr/bin/env node
/**
 * After a build, refresh the copy of this plugin that each DSH profile has installed.
 *
 * `pnpm run build` deletes and recreates lib/, so the files the profile installed are left behind:
 * they were hard-linked at install time and pnpm considers the dependency unchanged, so it will not
 * re-link them (verified: a plain install, --force and a re-add all leave the old inode in place).
 * Only removing the installed directory and re-running `pnpm install` re-creates the links. That is
 * what this does, for every profile whose package.json owns a copy of this package.
 *
 * A profile that only lists this package in `dsh.profile.bundles` (its dependencies stay empty)
 * owns no copy: the harness resolves it through the shared `$DSH_HOME/profiles/node_modules`
 * fallback, which links the bundle's real directory, so there is nothing to refresh there.
 *
 * Refreshing is destructive (pnpm re-links a `file:` directory dependency only once its entry is
 * gone), so the current copy is moved aside first and restored whenever the install fails: a stale
 * copy is far better than a missing plugin. Failures print the tail of pnpm's own log instead of a
 * bare "Command failed", and a `file:` pin left behind by a moved repository is repaired in place,
 * because that state makes every install variant fail with ENOENT before anything needs to be
 * removed (verified: `--force`, `--fix-lockfile`, `pnpm add` and a plain install all reuse the pin).
 *
 * With no matching profile (CI, a fresh clone, another machine) it is a no-op and exits 0, so it can
 * sit at the end of the build without affecting the release gate.
 *
 * Usage: node scripts/sync-installed-profiles.mjs [--check] [--home <DSH_HOME>]
 */
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { homedir, tmpdir } from 'node:os'

const repo = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const check = argv.includes('--check')
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const home = resolve(flag('--home') ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const profilesDir = join(home, 'profiles')
const sharedDir = join(profilesDir, 'node_modules')
const name = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).name

/** Profiles that declare this package as a dependency or as a bundle, with the declared specifier. */
function declaredProfiles() {
  const found = []
  let entries
  try { entries = readdirSync(profilesDir, { withFileTypes: true }) } catch { return found }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const dir = join(profilesDir, entry.name)
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      const dependency = pkg.dependencies?.[name]
      const asBundle = Array.isArray(pkg.dsh?.profile?.bundles) && pkg.dsh.profile.bundles.includes(name)
      if (dependency !== undefined || asBundle) found.push({ dir, dependency })
    } catch { /* an unreadable manifest is not fatal */ }
  }
  return found
}

/** Absolute directory a `file:`/`link:` dependency points at, or undefined for other specifiers. */
function localDependencyTarget(dir, specifier) {
  if (typeof specifier !== 'string') return undefined
  const match = /^(?:file|link):(.*)$/i.exec(specifier.trim())
  const target = match === null ? '' : match[1].trim()
  return target === '' ? undefined : resolve(dir, target)
}

/** Drop one layer of surrounding quotes from a YAML scalar. */
function unquote(value) {
  const trimmed = value.trim()
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed)
  return quoted === null ? trimmed : quoted[2]
}

/**
 * The `file:` directory pnpm-lock.yaml pinned for this package, or undefined when it pins none.
 *
 * pnpm resolves a `file:` directory dependency from this pin, not from package.json, which is why a
 * moved repository keeps installing from the old location.
 */
function lockedPin(dir) {
  const lockfile = join(dir, 'pnpm-lock.yaml')
  if (!existsSync(lockfile)) return undefined
  const lines = readFileSync(lockfile, 'utf8').split(/\r?\n/)
  const key = new RegExp('^  ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '@(?:file|link):(.+):$')
  for (let i = 0; i < lines.length; i += 1) {
    const match = key.exec(lines[i])
    if (match === null) continue
    const resolution = /^\s+resolution:\s*\{\s*directory:\s*([^,}]+?)\s*[,}]/.exec(lines[i + 1] ?? '')
    const pinned = unquote(resolution === null ? match[1] : resolution[1])
    return { lockfile, pinned, dir: resolve(dir, pinned) }
  }
  return undefined
}

/** A pin that is already broken, with the path the manifest declares instead, or undefined. */
function stalePin(dir, declared) {
  if (declared === undefined) return undefined
  const pin = lockedPin(dir)
  if (pin === undefined || existsSync(pin.dir)) return undefined
  const replacement = relative(dir, declared).split(sep).join('/')
  return replacement === pin.pinned ? undefined : { ...pin, replacement }
}

/**
 * Rewrite a stale pin to the directory the manifest declares.
 *
 * Only the pin is rewritten: re-resolving the whole lockfile would silently move every other
 * dependency of the profile to a newer version.
 */
function repairStalePin(dir, declared) {
  const stale = stalePin(dir, declared)
  if (stale === undefined) return
  const content = readFileSync(stale.lockfile, 'utf8')
  const repaired = content.split(stale.pinned).join(stale.replacement)
  if (repaired === content) return
  writeFileSync(stale.lockfile, repaired)
  console.log('sync-installed-profiles: repaired the stale ' + basename(stale.lockfile) + ' pin in ' + dir + ' (' + stale.pinned + ' -> ' + stale.replacement + ')')
}

/** Last lines of pnpm's own log, so a failed install reports a cause instead of "Command failed". */
function installLogTail(log) {
  try {
    const lines = readFileSync(log, 'utf8').trim().split(/\r?\n/).filter(line => line.trim() !== '')
    return lines.length === 0 ? undefined : lines.slice(-8).join(' / ')
  } catch { return undefined }
}

/**
 * Run `pnpm install` in one profile.
 *
 * pnpm's output goes to a log file rather than a pipe: the harness sandbox refuses piped stdio, and
 * the log is what turns a bare execFileSync error into an actionable message.
 */
function installProfile(dir) {
  const log = join(tmpdir(), 'dsh-sync-installed-profiles-' + process.pid + '.log')
  let fd
  try { fd = openSync(log, 'w') } catch { fd = undefined }
  const stdio = fd === undefined ? 'ignore' : ['ignore', fd, fd]
  try {
    if (process.platform === 'win32') execFileSync('cmd', ['/c', 'pnpm install'], { cwd: dir, stdio })
    else execFileSync('pnpm', ['install'], { cwd: dir, stdio })
    return { ok: true }
  } catch (error) {
    return { ok: false, detail: installLogTail(log) ?? (error instanceof Error ? error.message : String(error)) }
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { rmSync(log, { force: true }) } catch { /* a leftover log is harmless */ }
  }
}

/** Move the installed copy aside, reinstall it, and restore the previous copy when that fails. */
function refreshInstalled(dir) {
  const installed = join(dir, 'node_modules', name)
  const backup = installed + '.sync-backup'
  rmSync(backup, { recursive: true, force: true })
  renameSync(installed, backup)
  const result = installProfile(dir)
  if (!result.ok) {
    rmSync(installed, { recursive: true, force: true })
    renameSync(backup, installed)
    return result
  }
  // pnpm exits 0 after pruning a copy the profile no longer declares; keeping the old copy is right
  // there too, because the plugin disappearing from the profile is exactly what this must prevent.
  if (!existsSync(installed)) {
    renameSync(backup, installed)
    return { ok: false, detail: 'pnpm install completed without creating the package directory (is it still a dependency of that profile?)' }
  }
  try { rmSync(backup, { recursive: true, force: true }) } catch { /* a stale .sync-backup is inert */ }
  breakHardlinks(installed)
  return result
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

const profiles = declaredProfiles()
if (profiles.length === 0) {
  ensureRepoHasNoHardlinks()
  console.log('sync-installed-profiles: no profile installs ' + name + ' (nothing to refresh)')
  process.exit(0)
}

let refreshed = 0
let installedProfiles = 0
for (const profile of profiles) {
  const installed = join(profile.dir, 'node_modules', name)
  if (!existsSync(installed)) {
    const shared = join(sharedDir, name)
    // A bundle-only profile is served by the harness' shared fallback (a link to the bundle's real
    // directory), so it owns no copy to keep in sync; pointing it at `pnpm install` would be wrong
    // advice, since its dependencies are deliberately empty.
    if (profile.dependency === undefined && existsSync(shared)) {
      console.log('sync-installed-profiles: ' + profile.dir + ' declares ' + name + ' as a bundle only; it resolves through ' + shared + ' (nothing to refresh)')
    } else {
      console.log('sync-installed-profiles: ' + profile.dir + ' declares ' + name + ' but has no installed copy; run pnpm install there')
    }
    continue
  }
  installedProfiles += 1
  const declared = localDependencyTarget(profile.dir, profile.dependency)
  if (declared !== undefined && !existsSync(declared)) {
    console.log('! sync-installed-profiles: ' + profile.dir + ' depends on ' + declared + ', which does not exist; kept the installed copy untouched')
    continue
  }
  if (check) {
    const stale = stalePin(profile.dir, declared)
    if (stale !== undefined) console.log('sync-installed-profiles: would repair the stale ' + basename(stale.lockfile) + ' pin in ' + profile.dir + ' (' + stale.pinned + ' -> ' + stale.replacement + ')')
    console.log('sync-installed-profiles: would refresh ' + installed)
    continue
  }
  try {
    repairStalePin(profile.dir, declared)
    const result = refreshInstalled(profile.dir)
    if (!result.ok) {
      console.log('! sync-installed-profiles: could not refresh ' + installed + ' — ' + result.detail + ' (kept the previous copy)')
      continue
    }
    refreshed += 1
    const entry = join(installed, 'lib', 'index.js')
    console.log('sync-installed-profiles: refreshed ' + installed + (existsSync(entry) ? '' : ' (warning: ' + entry + ' is missing)'))
  } catch (error) {
    // The install never ran, or the copy could not be moved aside: put it back and report.
    const backup = installed + '.sync-backup'
    try { if (!existsSync(installed) && existsSync(backup)) renameSync(backup, installed) } catch { /* nothing else can be done here */ }
    console.log('! sync-installed-profiles: could not refresh ' + installed + ' — ' + (error instanceof Error ? error.message : String(error)) + ' (kept the previous copy)')
  }
}
ensureRepoHasNoHardlinks()
// The denominator counts profiles that really own a copy: bundle-only profiles have nothing to
// refresh, so folding them in would make a healthy run read as "1 of 2 refreshed".
console.log('sync-installed-profiles: ' + refreshed + ' of ' + installedProfiles + ' installed profile copy/copies refreshed')
