# Minecraft Discord Bot (Interactive Server Creation)

This bot creates and manages local Minecraft Java Edition servers from Discord.
The creation flow is interactive: run `/mc-wizard`, fill the modal, then confirm with a button.

## Features

- Interactive server creation (`/mc-wizard`)
- Start server (`/mc-start`)
- Stop server (`/mc-stop`)
- Check status (`/mc-status`)
- List created servers (`/mc-list`)
- Show recent logs (`/mc-logs`)

## How It Works

- The bot runs on the same machine that will host Minecraft servers.
- For creation, it downloads the official `server.jar` for the selected version from Mojang metadata.
- It creates:
  - `server.jar`
  - `eula.txt` with `eula=true`
  - `server.properties`
  - `bot-config.json`

## Requirements

- Node.js 20+
- Java 17+ (Java path must be reachable by `JAVA_PATH`)
- A Discord bot application

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env template and edit values:

```bash
copy .env.example .env
```

3. Set `.env`:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_app_client_id
DISCORD_GUILD_ID=your_test_guild_id
MC_BASE_DIR=./servers
JAVA_PATH=java
```

Notes:
- Keep `DISCORD_GUILD_ID` for fast test command updates (guild scope).
- Remove `DISCORD_GUILD_ID` to register globally (can take longer to appear).

4. Register slash commands:

```bash
npm run register
```

5. Start bot:

```bash
npm start
```

## Commands

- `/mc-wizard`
  - Opens an interactive modal to input server settings.
  - After submit, press **Create Server** to execute.
- `/mc-start server:<name> [memory:<mb>]`
- `/mc-stop server:<name>`
- `/mc-status server:<name>`
- `/mc-list`
- `/mc-logs server:<name> [lines:<n>]`

## Security / Operations Notes

- Any user who can use slash commands in the server can operate this bot unless you restrict command permissions in Discord.
- Open the selected Minecraft port on your firewall/router if players connect from outside your network.
- You are responsible for complying with Mojang/Minecraft EULA and terms.
