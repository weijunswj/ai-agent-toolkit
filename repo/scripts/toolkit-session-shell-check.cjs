#!/usr/bin/env node
'use strict';

// Answers whether this shell received the Toolkit session entry and whether it matches
// this shell's own non-empty session ID. This check grants no permission or authority.
if (process.argv.length !== 2) process.exit(1);

const present = Object.hasOwn(process.env, 'TOOLKIT_HOST_SESSION');
const toolkit = process.env.TOOLKIT_HOST_SESSION;
const session = process.env.CLAUDE_CODE_SESSION_ID;
const equal = Boolean(toolkit && session && toolkit === session);
process.stdout.write(`${JSON.stringify({ present, equal })}\n`);
