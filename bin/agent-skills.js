#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');

const packageRoot = path.resolve(__dirname, '..');
const sourceSkillsDir = path.join(packageRoot, 'skills');

const TARGETS = {
  pi: path.join(os.homedir(), '.pi/agent/skills'),
  agents: path.join(os.homedir(), '.agents/skills'),
  claude: path.join(os.homedir(), '.claude/skills'),
  codex: path.join(os.homedir(), '.codex/skills'),
  openclaw: path.join(os.homedir(), '.agents/skills'),
  project: path.join(process.cwd(), '.pi/skills'),
  'project-pi': path.join(process.cwd(), '.pi/skills'),
  'project-agents': path.join(process.cwd(), '.agents/skills'),
  'project-claude': path.join(process.cwd(), '.claude/skills'),
  'project-codex': path.join(process.cwd(), '.codex/skills'),
};

function usage() {
  console.log(`Usage: agent-skills [command] [options]

Install this package's Agent Skills into a local skills directory.

Recommended cross-agent installer:
  npx skills add aholbreich/agent-skills -g

This fallback installer copies files for environments where the Skills CLI is unavailable.

Commands:
  install                 Install skills (default command)
  list                    List bundled skills
  paths                   Show target install paths
  help                    Show this help

Options for install:
  --target NAME           pi | agents | claude | codex | openclaw | project | project-agents | project-claude | project-codex (default: agents)
  --dir PATH              Custom skills directory, overrides --target
  --skill NAME            Install only selected skill(s); repeatable, comma-separated, or '*' for all
  --pick                  Interactively choose which bundled skills to install
  --force                 Overwrite existing skill directories
  --dry-run               Show what would be copied without writing

Examples:
  npx skills add aholbreich/agent-skills -g
  npx @aholbreich/agent-skills
  npx @aholbreich/agent-skills install --skill jira-browser-fetch
  npx @aholbreich/agent-skills install --pick
  npx @aholbreich/agent-skills install --target agents --force
  npx @aholbreich/agent-skills install --target pi --force
  npx @aholbreich/agent-skills install --target project
  npx @aholbreich/agent-skills install --target claude
  npx @aholbreich/agent-skills install --target codex
  npx @aholbreich/agent-skills install --target agents
  npx @aholbreich/agent-skills install --dir ~/.pi/agent/skills
  npx @aholbreich/agent-skills list

Pi-native install is also supported:
  pi install npm:@aholbreich/agent-skills
`);
}

async function listSkills() {
  const entries = await fsp.readdir(sourceSkillsDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && fs.existsSync(path.join(sourceSkillsDir, e.name, 'SKILL.md')))
    .map(e => e.name)
    .sort();
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

async function copyDir(src, dest) {
  await fsp.cp(src, dest, { recursive: true, force: true, errorOnExist: false });
}

function addSkillFilters(filters, value) {
  if (!value) throw new Error('--skill requires a skill name');
  for (const item of String(value).split(',')) {
    const skill = item.trim();
    if (skill) filters.push(skill);
  }
}

function selectSkills(allSkills, filters) {
  if (!filters.length || filters.includes('*')) return allSkills;
  const known = new Set(allSkills);
  const selected = [...new Set(filters)];
  const unknown = selected.filter(skill => !known.has(skill));
  if (unknown.length) {
    throw new Error(`Unknown skill(s): ${unknown.join(', ')}. Available: ${allSkills.join(', ')}`);
  }
  return selected.sort();
}

function parsePickedSkills(answer, allSkills) {
  const value = String(answer || '').trim();
  if (!value || value === '*') return allSkills;
  const selected = [];
  for (const raw of value.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    if (/^\d+$/.test(token)) {
      const index = Number(token) - 1;
      if (index < 0 || index >= allSkills.length) throw new Error(`Invalid skill number: ${token}`);
      selected.push(allSkills[index]);
    } else {
      selected.push(token);
    }
  }
  return selectSkills(allSkills, selected);
}

async function pickSkills(allSkills) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('--pick requires an interactive terminal; use --skill NAME for non-interactive installs');
  }
  console.log('Bundled skills:');
  allSkills.forEach((skill, index) => console.log(`  ${index + 1}) ${skill}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Install which skills? Enter numbers/names separated by commas, or blank for all: ');
    return parsePickedSkills(answer, allSkills);
  } finally {
    rl.close();
  }
}

async function install(args) {
  let target = 'agents';
  let customDir = '';
  let force = false;
  let dryRun = false;
  let pick = false;
  const skillFilters = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--target') target = args[++i];
    else if (a === '--dir') customDir = args[++i];
    else if (a === '--skill' || a === '-s') addSkillFilters(skillFilters, args[++i]);
    else if (a === '--pick') pick = true;
    else if (a === '--force') force = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '-h' || a === '--help') { usage(); return; }
    else throw new Error(`Unknown install option: ${a}`);
  }

  if (!customDir && !TARGETS[target]) {
    throw new Error(`Unknown target '${target}'. Valid targets: ${Object.keys(TARGETS).join(', ')}`);
  }
  if (pick && skillFilters.length) {
    throw new Error('Use either --pick or --skill, not both');
  }

  const destRoot = path.resolve(expandHome(customDir || TARGETS[target]));
  const allSkills = await listSkills();
  const skills = pick ? await pickSkills(allSkills) : selectSkills(allSkills, skillFilters);

  console.log(`Installing ${skills.length} of ${allSkills.length} skill(s) to ${destRoot}`);
  if (dryRun) console.log('Dry run: no files will be written.');

  if (!dryRun) await fsp.mkdir(destRoot, { recursive: true });

  let installed = 0;
  let skipped = 0;
  for (const skill of skills) {
    const src = path.join(sourceSkillsDir, skill);
    const dest = path.join(destRoot, skill);
    const exists = fs.existsSync(dest);
    if (exists && !force) {
      console.log(`SKIP ${skill} (already exists; use --force to overwrite)`);
      skipped++;
      continue;
    }
    console.log(`${exists ? 'OVERWRITE' : 'INSTALL'} ${skill}`);
    if (!dryRun) {
      if (exists) await fsp.rm(dest, { recursive: true, force: true });
      await copyDir(src, dest);
    }
    installed++;
  }

  console.log(`Done. Installed: ${installed}. Skipped: ${skipped}.`);
  if (target.startsWith('project') && !customDir) {
    console.log('Project-local skills are available when running an Agent Skills-compatible tool inside this project.');
  } else if (target === 'pi' && !customDir) {
    console.log('Restart Pi or start a new session to discover newly installed skills.');
  }
}

async function showPaths() {
  for (const [name, p] of Object.entries(TARGETS)) console.log(`${name.padEnd(8)} ${p}`);
}

async function main() {
  const [cmdRaw, ...rest] = process.argv.slice(2);
  const cmd = cmdRaw || 'install';

  if (cmd === 'help' || cmd === '-h' || cmd === '--help') return usage();
  if (cmd === 'install') return install(rest);
  if (cmd === 'list') {
    for (const skill of await listSkills()) console.log(skill);
    return;
  }
  if (cmd === 'paths') return showPaths();

  // Support `npx @aholbreich/agent-skills --target project` as shorthand for install.
  if (cmd.startsWith('-')) return install([cmd, ...rest]);

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch(err => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
