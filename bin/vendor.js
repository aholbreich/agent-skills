#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

// Every installed skill folder must remain self-contained. Keep this manifest
// explicit so product-specific libraries are not copied into unrelated skills.
const VENDORS = [
  {
    source: 'lib/atlassian-browser.js',
    destination: 'atlassian-browser.js',
    skills: ['bitbucket-browser-fetch', 'confluence-update', 'jira-browser-fetch', 'jira-update'],
  },
  {
    source: 'lib/browser-context.js',
    destination: 'browser-context.js',
    skills: ['confluence-browser-fetch'],
  },
  {
    source: 'lib/launch-windows-browser.ps1',
    destination: 'launch-windows-browser.ps1',
    skills: ['confluence-browser-fetch'],
  },
];

function runVendor({ checkOnly = false } = {}) {
  const problems = [];
  let copyCount = 0;
  for (const vendor of VENDORS) {
    const source = path.join(repoRoot, vendor.source);
    if (!fs.existsSync(source)) {
      problems.push(`source missing: ${vendor.source}`);
      continue;
    }
    const content = fs.readFileSync(source);
    for (const skill of vendor.skills) {
      const dest = path.join(repoRoot, 'skills', skill, 'scripts', vendor.destination);
      const rel = path.relative(repoRoot, dest);
      if (!fs.existsSync(path.dirname(dest))) {
        problems.push(`skill scripts directory missing: ${path.relative(repoRoot, path.dirname(dest))}`);
        continue;
      }
      if (checkOnly) {
        if (!fs.existsSync(dest)) { problems.push(`missing: ${rel}`); continue; }
        if (!fs.readFileSync(dest).equals(content)) { problems.push(`drift:   ${rel}`); continue; }
      } else {
        fs.writeFileSync(dest, content);
        console.log(`vendored -> ${rel}`);
      }
      copyCount++;
    }
  }

  if (problems.length) {
    console.error(`vendor${checkOnly ? ' --check' : ''} failed:`);
    for (const problem of problems) console.error(`  ${problem}`);
    if (checkOnly) console.error('\nRun `npm run vendor` to regenerate vendored copies from lib/.');
    return 1;
  }
  if (checkOnly) console.log(`vendor --check: ${copyCount} explicit vendored copies match their lib/ sources.`);
  return 0;
}

if (require.main === module) process.exitCode = runVendor({ checkOnly: process.argv.includes('--check') });

module.exports = { VENDORS, runVendor };
