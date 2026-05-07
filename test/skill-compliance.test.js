'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const skillsDir = path.join(repoRoot, 'skills');

function parseFrontmatter(text) {
  assert.match(text, /^---\n/, 'SKILL.md must start with YAML frontmatter');
  const end = text.indexOf('\n---\n', 4);
  assert.notEqual(end, -1, 'SKILL.md frontmatter must be closed by ---');
  const raw = text.slice(4, end).trim();
  const fm = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[m[1]] = value;
  }
  return fm;
}

test('all bundled skills follow Agent Skills structure and frontmatter rules', () => {
  const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
  assert.ok(dirs.length >= 2, 'expected bundled skills');

  for (const dir of dirs) {
    const skillName = dir.name;
    const skillPath = path.join(skillsDir, skillName, 'SKILL.md');
    assert.equal(fs.existsSync(skillPath), true, `${skillName} must contain SKILL.md`);

    const text = fs.readFileSync(skillPath, 'utf8');
    const fm = parseFrontmatter(text);

    assert.equal(fm.name, skillName, `${skillName}: frontmatter name must match directory name`);
    assert.match(fm.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${skillName}: name must be lowercase kebab-case`);
    assert.ok(fm.name.length <= 64, `${skillName}: name should be <= 64 chars`);

    assert.ok(fm.description, `${skillName}: description is required`);
    assert.ok(fm.description.length <= 1024, `${skillName}: description should be <= 1024 chars`);

    assert.equal(fm.license, 'MIT', `${skillName}: license should be MIT`);
    assert.ok(fm.compatibility && fm.compatibility.includes('Agent Skills'), `${skillName}: compatibility should mention Agent Skills`);

    assert.match(text, new RegExp(`#\\s+${skillName.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ')}`, 'i'), `${skillName}: should contain a title heading`);
  }
});

test('package exposes conventional skills directory for registry discovery', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.pi.skills, ['skills']);
  assert.ok(pkg.keywords.includes('pi-package'));
  assert.ok(pkg.keywords.includes('agent-skills'));
  assert.ok(pkg.keywords.includes('skills.sh'));
  assert.ok(pkg.files.includes('skills/'));
  assert.ok(pkg.files.includes('COMPATIBILITY.md'));
});

test('docs advertise Skills CLI and Pi-native install paths', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const compatibility = fs.readFileSync(path.join(repoRoot, 'COMPATIBILITY.md'), 'utf8');

  for (const text of [readme, compatibility]) {
    assert.match(text, /npx skills add aholbreich\/agent-skills/);
    assert.match(text, /pi install npm:@aholbreich\/agent-skills/);
    assert.match(text, /collision/i);
  }
});
