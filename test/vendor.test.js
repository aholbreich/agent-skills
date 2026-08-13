'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { VENDORS } = require('../bin/vendor');

const repoRoot = path.resolve(__dirname, '..');

test('vendor script copies only explicitly declared shared files', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'bin/vendor.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, `vendor failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

  for (const vendor of VENDORS) {
    const expected = fs.readFileSync(path.join(repoRoot, vendor.source), 'utf8');
    for (const skill of vendor.skills) {
      const dest = path.join(repoRoot, 'skills', skill, 'scripts', vendor.destination);
      assert.equal(fs.existsSync(dest), true, `${skill}: missing ${vendor.destination}`);
      assert.equal(fs.readFileSync(dest, 'utf8'), expected, `${skill}: ${vendor.destination} diverged from source`);
    }
  }

  const skillsDir = path.join(repoRoot, 'skills');
  const skills = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(item => item.isDirectory());
  for (const vendor of VENDORS) {
    for (const entry of skills) {
      const copy = path.join(skillsDir, entry.name, 'scripts', vendor.destination);
      assert.equal(fs.existsSync(copy), vendor.skills.includes(entry.name), `${entry.name}: unexpected ${vendor.destination} vendoring state`);
    }
  }
});

test('vendor --check detects no drift', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'bin/vendor.js'), '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `vendor check failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /explicit vendored copies/);
});
