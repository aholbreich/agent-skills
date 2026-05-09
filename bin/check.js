#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

async function listJsFiles(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

async function collectTargets() {
  const files = [];
  for (const d of ['bin', 'lib']) files.push(...await listJsFiles(path.join(repoRoot, d)));
  const skillsDir = path.join(repoRoot, 'skills');
  for (const entry of await fsp.readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    files.push(...await listJsFiles(path.join(skillsDir, entry.name, 'scripts')));
  }
  return files.sort();
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  const skipVendor = process.argv.includes('--no-vendor');

  if (!skipVendor) {
    const vendor = spawnSync(process.execPath, [path.join(repoRoot, 'bin/vendor.js')], { stdio: 'inherit' });
    if (vendor.status !== 0) process.exit(vendor.status || 1);
  }

  const targets = await collectTargets();
  const failures = [];
  const start = Date.now();
  for (const file of targets) {
    const rel = path.relative(repoRoot, file);
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status === 0) {
      if (verbose) console.log(`ok  ${rel}`);
    } else {
      console.error(`FAIL ${rel}`);
      failures.push({ rel, stderr: result.stderr });
    }
  }
  const ms = Date.now() - start;

  if (failures.length) {
    console.error(`\n${failures.length} file(s) failed syntax check:`);
    for (const f of failures) {
      console.error(`\n--- ${f.rel} ---`);
      console.error(f.stderr.trim());
    }
    process.exit(1);
  }
  console.log(`Syntax-checked ${targets.length} file(s) in ${ms}ms.`);
}

module.exports = { collectTargets, listJsFiles };

if (require.main === module) {
  main().catch(err => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
