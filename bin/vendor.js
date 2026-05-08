#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const source = path.join(repoRoot, 'lib/atlassian-browser.js');
const skillsDir = path.join(repoRoot, 'skills');

if (!fs.existsSync(source)) {
  console.error(`vendor: source not found at ${source}`);
  process.exit(1);
}

const content = fs.readFileSync(source);
const skills = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
for (const skill of skills) {
  const scriptsDir = path.join(skillsDir, skill.name, 'scripts');
  if (!fs.existsSync(scriptsDir)) continue;
  const dest = path.join(scriptsDir, 'atlassian-browser.js');
  fs.writeFileSync(dest, content);
  console.log(`vendored -> ${path.relative(repoRoot, dest)}`);
}
