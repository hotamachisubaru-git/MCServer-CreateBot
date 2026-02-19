import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const VERSION_MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const MAX_BUFFERED_LINES = 500;

function sanitizeServerName(name) {
  const normalized = String(name || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(normalized)) {
    throw new Error(
      "Server name must be 3-32 chars and use only letters, numbers, _ or -.",
    );
  }
  return normalized;
}

function parsePositiveInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function buildServerProperties({ port, motd }) {
  const escapedMotd = String(motd || "Minecraft Server")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ")
    .replaceAll(":", "\\:")
    .replaceAll("=", "\\=");

  return [
    "accepts-transfers=false",
    "allow-flight=false",
    "allow-nether=true",
    "broadcast-console-to-ops=true",
    "difficulty=normal",
    "enable-command-block=false",
    "enable-jmx-monitoring=false",
    "enable-query=false",
    "enable-rcon=false",
    "enforce-secure-profile=true",
    "enforce-whitelist=false",
    "entity-broadcast-range-percentage=100",
    "force-gamemode=false",
    "function-permission-level=2",
    "gamemode=survival",
    "generate-structures=true",
    "hardcore=false",
    "hide-online-players=false",
    "max-players=20",
    "max-tick-time=60000",
    "max-world-size=29999984",
    `motd=${escapedMotd}`,
    "network-compression-threshold=256",
    "online-mode=true",
    "op-permission-level=4",
    "player-idle-timeout=0",
    "prevent-proxy-connections=false",
    "pvp=true",
    "rate-limit=0",
    "resource-pack-prompt=",
    "resource-pack-sha1=",
    "server-ip=",
    `server-port=${port}`,
    "simulation-distance=10",
    "spawn-animals=true",
    "spawn-monsters=true",
    "spawn-npcs=true",
    "spawn-protection=16",
    "sync-chunk-writes=true",
    "text-filtering-config=",
    "use-native-transport=true",
    "view-distance=10",
    "white-list=false",
  ].join("\n");
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export class MinecraftManager {
  constructor({ baseDir, javaPath = "java" }) {
    this.baseDir = baseDir;
    this.javaPath = javaPath;
    this.running = new Map();
  }

  async init() {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async createServer({ name, version, port, memoryMb, motd }) {
    const serverName = sanitizeServerName(name);
    const validatedPort = parsePositiveInteger(port, "Port", 1024, 65535);
    const validatedMemory = parsePositiveInteger(
      memoryMb,
      "Memory",
      512,
      65536,
    );
    const versionInput = String(version || "").trim() || "latest";
    const serverDir = path.join(this.baseDir, serverName);

    try {
      await fs.mkdir(serverDir);
    } catch (error) {
      if (error && error.code === "EEXIST") {
        throw new Error(`Server "${serverName}" already exists.`);
      }
      throw error;
    }

    try {
      const versionEntry = await this.resolveVersionEntry(versionInput);
      const versionMeta = await this.fetchJson(versionEntry.url);
      const serverDownload = versionMeta?.downloads?.server;

      if (!serverDownload?.url) {
        throw new Error(`Version "${versionEntry.id}" does not provide server.jar`);
      }

      await this.downloadFile(serverDownload.url, path.join(serverDir, "server.jar"));

      await fs.writeFile(path.join(serverDir, "eula.txt"), "eula=true\n", "utf8");
      await fs.writeFile(
        path.join(serverDir, "server.properties"),
        `${buildServerProperties({
          port: validatedPort,
          motd,
        })}\n`,
        "utf8",
      );

      const config = {
        name: serverName,
        version: versionEntry.id,
        port: validatedPort,
        memoryMb: validatedMemory,
        motd: motd || "Minecraft Server",
        createdAt: new Date().toISOString(),
      };

      await fs.writeFile(
        path.join(serverDir, "bot-config.json"),
        `${JSON.stringify(config, null, 2)}\n`,
        "utf8",
      );
      await fs.writeFile(
        path.join(serverDir, "start.ps1"),
        `& "${this.javaPath}" -Xms${validatedMemory}M -Xmx${validatedMemory}M -jar server.jar nogui\n`,
        "utf8",
      );

      return config;
    } catch (error) {
      await fs.rm(serverDir, { recursive: true, force: true });
      throw error;
    }
  }

  async listServers() {
    const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
    const servers = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const serverJarPath = path.join(this.baseDir, entry.name, "server.jar");
      if (await exists(serverJarPath)) {
        servers.push(entry.name);
      }
    }

    servers.sort((a, b) => a.localeCompare(b));
    return servers;
  }

  async getStatus(name) {
    const serverName = sanitizeServerName(name);
    const serverDir = path.join(this.baseDir, serverName);
    const serverExists = await exists(serverDir);
    const runningEntry = this.running.get(serverName);
    const config = await this.readServerConfig(serverName);

    return {
      name: serverName,
      exists: serverExists,
      running: Boolean(runningEntry),
      pid: runningEntry?.process?.pid || null,
      startedAt: runningEntry?.startedAt || null,
      config,
    };
  }

  async startServer(name, memoryOverrideMb = null) {
    const serverName = sanitizeServerName(name);
    const serverDir = path.join(this.baseDir, serverName);
    const serverJarPath = path.join(serverDir, "server.jar");

    if (!(await exists(serverJarPath))) {
      throw new Error(`Server "${serverName}" does not exist.`);
    }

    if (this.running.has(serverName)) {
      throw new Error(`Server "${serverName}" is already running.`);
    }

    const config = await this.readServerConfig(serverName);
    const memoryMb =
      memoryOverrideMb == null
        ? config?.memoryMb || 2048
        : parsePositiveInteger(memoryOverrideMb, "Memory", 512, 65536);

    const child = spawn(
      this.javaPath,
      [`-Xms${memoryMb}M`, `-Xmx${memoryMb}M`, "-jar", "server.jar", "nogui"],
      {
        cwd: serverDir,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    const state = {
      process: child,
      startedAt: new Date().toISOString(),
      logs: [],
    };

    this.running.set(serverName, state);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => this.appendLogs(serverName, chunk));
    child.stderr.on("data", (chunk) => this.appendLogs(serverName, chunk));

    child.on("error", (error) => {
      this.appendLogs(serverName, `[process error] ${error.message}`);
      this.running.delete(serverName);
    });

    child.on("exit", (code, signal) => {
      this.appendLogs(
        serverName,
        `[process exit] code=${code ?? "null"} signal=${signal ?? "null"}`,
      );
      this.running.delete(serverName);
    });

    return {
      name: serverName,
      pid: child.pid || null,
      memoryMb,
    };
  }

  async stopServer(name) {
    const serverName = sanitizeServerName(name);
    const state = this.running.get(serverName);

    if (!state) {
      throw new Error(`Server "${serverName}" is not running.`);
    }

    const child = state.process;
    const exitPromise = once(child, "exit").then(() => true);

    if (child.exitCode == null) {
      child.stdin.write("stop\n");
    }

    const stopped = await Promise.race([
      exitPromise,
      new Promise((resolve) => setTimeout(() => resolve(false), 15000)),
    ]);

    if (!stopped && child.exitCode == null) {
      child.kill();
      await once(child, "exit");
    }

    return { name: serverName };
  }

  async getRecentLogs(name, lineCount = 20) {
    const serverName = sanitizeServerName(name);
    const lines = parsePositiveInteger(lineCount, "Lines", 1, 200);
    const runningEntry = this.running.get(serverName);

    if (runningEntry) {
      return runningEntry.logs.slice(-lines);
    }

    const logPath = path.join(this.baseDir, serverName, "logs", "latest.log");
    if (!(await exists(logPath))) {
      return [];
    }

    const text = await fs.readFile(logPath, "utf8");
    const allLines = text.split(/\r?\n/).filter(Boolean);
    return allLines.slice(-lines);
  }

  appendLogs(serverName, rawChunk) {
    const state = this.running.get(serverName);
    if (!state) {
      return;
    }

    const lines = String(rawChunk)
      .replaceAll("\r", "")
      .split("\n")
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return;
    }

    const timestamp = new Date().toISOString();
    for (const line of lines) {
      state.logs.push(`[${timestamp}] ${line}`);
    }

    if (state.logs.length > MAX_BUFFERED_LINES) {
      state.logs.splice(0, state.logs.length - MAX_BUFFERED_LINES);
    }
  }

  async readServerConfig(serverName) {
    const configPath = path.join(this.baseDir, serverName, "bot-config.json");
    if (!(await exists(configPath))) {
      return null;
    }

    const content = await fs.readFile(configPath, "utf8");
    return JSON.parse(content);
  }

  async resolveVersionEntry(versionInput) {
    const manifest = await this.fetchJson(VERSION_MANIFEST_URL);
    const candidate =
      versionInput.toLowerCase() === "latest"
        ? manifest?.latest?.release
        : versionInput;

    const entry = manifest?.versions?.find((item) => item.id === candidate);
    if (!entry) {
      throw new Error(`Unknown Minecraft version "${versionInput}".`);
    }

    return entry;
  }

  async fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    return response.json();
  }

  async downloadFile(url, destinationPath) {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${url} (${response.status})`);
    }

    const writable = createWriteStream(destinationPath);
    await pipeline(Readable.fromWeb(response.body), writable);
  }
}
