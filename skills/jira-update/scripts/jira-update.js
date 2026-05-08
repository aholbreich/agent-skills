#!/usr/bin/env node
'use strict';

function usage() {
  console.log(`Usage: jira-update <command> [options]

Commands:
  create                       Create a new issue from a JSON manifest
  comment ISSUE-KEY            Add a comment
  transition ISSUE-KEY         Move through workflow
  update-fields ISSUE-KEY      Partial field update
  link FROM-KEY                Link two issues

Run "jira-update <command> --help" for command-specific options.
Dry-run is the default; --apply is required to write.
`);
}

const args = process.argv.slice(2);
if (!args.length || args[0] === '-h' || args[0] === '--help') { usage(); process.exit(0); }

const command = args[0];
const validCommands = ['create', 'comment', 'transition', 'update-fields', 'link'];
if (!validCommands.includes(command)) {
  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(2);
}

console.error(`Command "${command}" not yet implemented.`);
process.exit(1);
