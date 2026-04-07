#!/bin/bash
# MemPalace PreCompact Hook — thin wrapper calling Node.js CLI
# All logic lives in @mempalace-ts/cli hook command
INPUT=$(cat)
echo "$INPUT" | npx mempalace-ts hook run --hook precompact --harness claude-code
