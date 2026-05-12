#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const source = path.join(repoRoot, 'lib/atlassian-browser.js');
const skillsDir = path.join(repoRoot, 'skills');
const checkOnly = process.argv.includes('--check');

if (!fs.existsSync(source)) {
  console.error(`vendor: source not found at ${source}`);
  process.exit(1);
}

const content = fs.readFileSync(source);
const skills = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
const problems = [];
for (const skill of skills) {
  const scriptsDir = path.join(skillsDir, skill.name, 'scripts');
  if (!fs.existsSync(scriptsDir)) continue;
  const dest = path.join(scriptsDir, 'atlassian-browser.js');
  const rel = path.relative(repoRoot, dest);
  if (checkOnly) {
    if (!fs.existsSync(dest)) { problems.push(`missing: ${rel}`); continue; }
    if (!fs.readFileSync(dest).equals(content)) { problems.push(`drift:   ${rel}`); continue; }
  } else {
    fs.writeFileSync(dest, content);
    console.log(`vendored -> ${rel}`);
  }
}

if (checkOnly) {
  if (problems.length) {
    console.error('vendor --check failed:');
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nRun `npm run vendor` to regenerate vendored copies from lib/atlassian-browser.js.');
    process.exit(1);
  }
  console.log(`vendor --check: all ${skills.length} skill copies match lib/atlassian-browser.js.`);
}
