'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const source = path.join(repoRoot, 'lib/atlassian-browser.js');

test('vendor script copies atlassian-browser.js into every skill', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'bin/vendor.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, `vendor failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

  const expected = fs.readFileSync(source, 'utf8');
  const skillsDir = path.join(repoRoot, 'skills');
  const skills = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const skill of skills) {
    const dest = path.join(skillsDir, skill.name, 'scripts/atlassian-browser.js');
    assert.equal(fs.existsSync(dest), true, `${skill.name}: missing vendored copy`);
    assert.equal(fs.readFileSync(dest, 'utf8'), expected, `${skill.name}: vendored copy diverged from source`);
  }
});
