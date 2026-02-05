#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { runCommand } from './commands.js';

const args = process.argv.slice(2);
const command = args[0];

runCommand(command, args.slice(1)).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
