# MemPalace Init

Guide the user through a complete MemPalace setup. Follow each step in order,
stopping to report errors and attempt remediation before proceeding.

## Step 1: Check Node.js version

Run `node --version` and confirm the version is 20.0.0 or higher. If Node.js
is not found or the version is too old, tell the user they need Node.js 20+
installed and stop.

## Step 2: Check if mempalace-ts is already installed

Run `npx mempalace-ts status` to see if the CLI is already accessible. If it
is, report the status and skip to Step 4.

## Step 3: Install mempalace-ts

Run `npm install -g @mempalace-ts/cli` (or use pnpm/yarn as appropriate).

### Error handling

If installation fails:
1. Try `npx @mempalace-ts/cli` as an alternative
2. If errors mention native dependencies (better-sqlite3), suggest installing
   build tools for the platform
3. If all attempts fail, report the error clearly and stop.

## Step 4: Ask for project directory

Ask the user which project directory they want to initialize with MemPalace.
Offer the current working directory as the default. Wait for their response
before continuing.

## Step 5: Initialize the palace

Run `mempalace-ts init <dir>` where `<dir>` is the directory from Step 4.

If this fails, report the error and stop.

## Step 6: Configure MCP server

Run the following command to register the MemPalace MCP server with Claude:

    claude mcp add mempalace -- npx @mempalace-ts/mcp

If this fails, report the error but continue to the next step (MCP
configuration can be done manually later).

## Step 7: Verify installation

Run `mempalace-ts status` and confirm the output shows a healthy palace.

## Step 8: Show next steps

Tell the user setup is complete and suggest these next actions:

- Mine project files: `mempalace-ts mine <dir>`
- Search memories: `mempalace-ts search "query"`
