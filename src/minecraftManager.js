import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const VANILLA_VERSION_MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const PAPER_PROJECT_API_URL = "https://api.papermc.io/v2/projects/paper";
const PURPUR_PROJECT_API_URL = "https://api.purpurmc.org/v2/purpur";

const MAX_BUFFERED_LINES = 500;
const CREATE_SUPPORTED_FORKS = new Set(["vanilla", "paper", "purpur"]);
const IMPORT_SUPPORTED_FORKS = new Set(["vanilla", "paper", "purpur", "custom"]);

function sanitizeServerName(name) {
  const normalized = String(name || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(normalized)) {
    throw new Error(
      "Server name must be 3-32 chars and use only letters, numbers, _ or -.",
    );
  }
  return normalized;
}

function parseIntegerRange(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function normalizeFork(forkInput, supportedForks) {
  const fork = String(forkInput || "vanilla").trim().toLowerCase();
  if (!supportedForks.has(fork)) {
    throw new Error(
      `Unsupported fork "${forkInput}". Supported: ${[...supportedForks].join(", ")}`,
    );
  }
  return fork;
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

function unescapePropertyValue(value) {
  return String(value || "")
    .replaceAll("\\:", ":")
    .replaceAll("\\=", "=")
    .replaceAll("\\n", " ");
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function parseMcVersion(version) {
  return String(version || "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function compareMcVersion(a, b) {
  const left = parseMcVersion(a);
  const right = parseMcVersion(b);
  const maxLen = Math.max(left.length, right.length);

  for (let i = 0; i < maxLen; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) {
      return l - r;
    }
  }
  return 0;
}

function pickLatestMcVersion(versions) {
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error("No versions available from upstream.");
  }
  return [...versions].sort(compareMcVersion).at(-1);
}

async function readServerProperties(serverPath) {
  const propertiesPath = path.join(serverPath, "server.properties");
  if (!(await exists(propertiesPath))) {
    return {};
  }

  const content = await fs.readFile(propertiesPath, "utf8");
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }

    const delimiterIndex = line.indexOf("=");
    if (delimiterIndex <= 0) {
      continue;
    }

    const key = line.slice(0, delimiterIndex).trim();
    const value = line.slice(delimiterIndex + 1).trim();
    if (key === "server-port") {
      const parsedPort = Number.parseInt(value, 10);
      if (Number.isInteger(parsedPort)) {
        result.port = parsedPort;
      }
    }
    if (key === "motd") {
      result.motd = unescapePropertyValue(value);
    }
  }

  return result;
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

  async createServer({ name, fork, version, port, memoryMb, motd }) {
    const serverName = sanitizeServerName(name);
    const normalizedFork = normalizeFork(fork, CREATE_SUPPORTED_FORKS);
    const validatedPort = parseIntegerRange(port, "Port", 1024, 65535);
    const validatedMemory = parseIntegerRange(memoryMb, "Memory", 512, 65536);
    const versionInput = String(version || "latest").trim() || "latest";
    const serverPath = path.join(this.baseDir, serverName);

    try {
      await fs.mkdir(serverPath);
    } catch (error) {
      if (error && error.code === "EEXIST") {
        throw new Error(`Server "${serverName}" already exists.`);
      }
      throw error;
    }

    try {
      const resolvedBuild = await this.resolveBuildForCreate({
        fork: normalizedFork,
        versionInput,
      });
      await this.downloadFile(
        resolvedBuild.jarUrl,
        path.join(serverPath, "server.jar"),
      );

      await fs.writeFile(path.join(serverPath, "eula.txt"), "eula=true\n", "utf8");
      await fs.writeFile(
        path.join(serverPath, "server.properties"),
        `${buildServerProperties({
          port: validatedPort,
          motd,
        })}\n`,
        "utf8",
      );

      const config = {
        name: serverName,
        source: "created",
        serverPath,
        jarFile: "server.jar",
        fork: normalizedFork,
        version: resolvedBuild.version,
        build: resolvedBuild.build ?? null,
        port: validatedPort,
        memoryMb: validatedMemory,
        motd: motd || serverName,
        createdAt: new Date().toISOString(),
      };

      await this.writeServerConfig(serverName, config);
      await fs.writeFile(
        path.join(serverPath, "start.ps1"),
        `& "${this.javaPath}" -Xms${validatedMemory}M -Xmx${validatedMemory}M -jar server.jar nogui\n`,
        "utf8",
      );

      return config;
    } catch (error) {
      await fs.rm(serverPath, { recursive: true, force: true });
      throw error;
    }
  }

  async importServer({ name, sourcePath, jarFile, fork, version, memoryMb }) {
    const serverName = sanitizeServerName(name);
    const resolvedSourcePath = path.resolve(String(sourcePath || "").trim());
    const selectedJarFile = String(jarFile || "server.jar").trim() || "server.jar";
    const selectedFork = normalizeFork(fork || "custom", IMPORT_SUPPORTED_FORKS);
    const selectedVersion = String(version || "unknown").trim() || "unknown";
    const selectedMemory = parseIntegerRange(memoryMb, "Memory", 512, 65536);

    if (!(await isDirectory(resolvedSourcePath))) {
      throw new Error(`Path "${resolvedSourcePath}" is not a directory.`);
    }

    const jarPath = path.join(resolvedSourcePath, selectedJarFile);
    if (!(await exists(jarPath))) {
      throw new Error(`Jar file not found: ${jarPath}`);
    }

    const serverProperties = await readServerProperties(resolvedSourcePath);
    const port = Number.isInteger(serverProperties.port)
      ? parseIntegerRange(serverProperties.port, "Port", 1024, 65535)
      : 25565;
    const motd = String(serverProperties.motd || serverName).trim() || serverName;

    const serverConfigDir = path.join(this.baseDir, serverName);
    const configPath = path.join(serverConfigDir, "bot-config.json");
    const serverConfigDirExists = await exists(serverConfigDir);
    if (serverConfigDirExists && (await exists(configPath))) {
      throw new Error(`Server "${serverName}" is already managed.`);
    }
    if (
      serverConfigDirExists &&
      path.resolve(serverConfigDir) !== path.resolve(resolvedSourcePath)
    ) {
      throw new Error(
        `A different directory already exists with alias "${serverName}".`,
      );
    }

    await fs.mkdir(serverConfigDir, { recursive: true });

    const config = {
      name: serverName,
      source: "imported",
      serverPath: resolvedSourcePath,
      jarFile: selectedJarFile,
      fork: selectedFork,
      version: selectedVersion,
      build: null,
      port,
      memoryMb: selectedMemory,
      motd,
      createdAt: new Date().toISOString(),
    };
    await this.writeServerConfig(serverName, config);
    return config;
  }

  async listServersDetailed() {
    const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
    const servers = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      let serverName = entry.name;
      try {
        serverName = sanitizeServerName(serverName);
      } catch {
        continue;
      }

      const managed = await this.resolveManagedServer(serverName);
      if (!managed) {
        continue;
      }

      servers.push({
        name: serverName,
        source: managed.config.source || "legacy",
        fork: managed.config.fork || "vanilla",
        version: managed.config.version || "unknown",
        running: this.running.has(serverName),
      });
    }

    servers.sort((a, b) => a.name.localeCompare(b.name));
    return servers;
  }

  async listServers() {
    const detailed = await this.listServersDetailed();
    return detailed.map((item) => item.name);
  }

  async getStatus(name) {
    const serverName = sanitizeServerName(name);
    const managed = await this.resolveManagedServer(serverName);
    const runningEntry = this.running.get(serverName);

    if (!managed) {
      return {
        name: serverName,
        exists: false,
        running: false,
        pid: null,
        startedAt: null,
        config: null,
      };
    }

    return {
      name: serverName,
      exists: true,
      running: Boolean(runningEntry),
      pid: runningEntry?.process?.pid || null,
      startedAt: runningEntry?.startedAt || null,
      config: managed.config,
      jarExists: managed.jarExists,
    };
  }

  async startServer(name, memoryOverrideMb = null) {
    const serverName = sanitizeServerName(name);
    const managed = await this.resolveManagedServer(serverName);
    if (!managed) {
      throw new Error(`Server "${serverName}" is not managed.`);
    }

    const { config } = managed;
    const jarPath = path.join(config.serverPath, config.jarFile);
    if (!(await exists(jarPath))) {
      throw new Error(`Jar file not found: ${jarPath}`);
    }

    if (this.running.has(serverName)) {
      throw new Error(`Server "${serverName}" is already running.`);
    }

    const memoryMb =
      memoryOverrideMb == null
        ? config.memoryMb || 2048
        : parseIntegerRange(memoryOverrideMb, "Memory", 512, 65536);

    const child = spawn(
      this.javaPath,
      [`-Xms${memoryMb}M`, `-Xmx${memoryMb}M`, "-jar", config.jarFile, "nogui"],
      {
        cwd: config.serverPath,
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
    const lines = parseIntegerRange(lineCount, "Lines", 1, 200);
    const managed = await this.resolveManagedServer(serverName);
    if (!managed) {
      throw new Error(`Server "${serverName}" is not managed.`);
    }

    const runningEntry = this.running.get(serverName);
    if (runningEntry) {
      return runningEntry.logs.slice(-lines);
    }

    const logPath = path.join(managed.config.serverPath, "logs", "latest.log");
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
    const sanitized = sanitizeServerName(serverName);
    const serverConfigDir = path.join(this.baseDir, sanitized);
    const configPath = path.join(serverConfigDir, "bot-config.json");
    if (!(await exists(configPath))) {
      return null;
    }

    const content = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(content);
    const serverPath = path.isAbsolute(parsed.serverPath || "")
      ? parsed.serverPath
      : path.resolve(serverConfigDir, parsed.serverPath || ".");

    return {
      ...parsed,
      name: sanitized,
      source:
        parsed.source ||
        (path.resolve(serverPath) === path.resolve(serverConfigDir)
          ? "created"
          : "imported"),
      fork: parsed.fork || "vanilla",
      version: parsed.version || "unknown",
      build: parsed.build ?? null,
      memoryMb: parsed.memoryMb || 2048,
      port: parsed.port || 25565,
      motd: parsed.motd || sanitized,
      serverPath,
      jarFile: parsed.jarFile || "server.jar",
    };
  }

  async writeServerConfig(serverName, config) {
    const sanitized = sanitizeServerName(serverName);
    const serverConfigDir = path.join(this.baseDir, sanitized);
    await fs.mkdir(serverConfigDir, { recursive: true });
    await fs.writeFile(
      path.join(serverConfigDir, "bot-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      "utf8",
    );
  }

  async resolveManagedServer(serverName) {
    const sanitized = sanitizeServerName(serverName);
    const serverConfigDir = path.join(this.baseDir, sanitized);
    const config = await this.readServerConfig(sanitized);
    if (config) {
      const jarExists = await exists(path.join(config.serverPath, config.jarFile));
      return {
        name: sanitized,
        serverConfigDir,
        config,
        jarExists,
      };
    }

    const legacyJar = path.join(serverConfigDir, "server.jar");
    if (!(await exists(legacyJar))) {
      return null;
    }

    const legacyServerProperties = await readServerProperties(serverConfigDir);
    return {
      name: sanitized,
      serverConfigDir,
      jarExists: true,
      config: {
        name: sanitized,
        source: "legacy",
        fork: "vanilla",
        version: "unknown",
        build: null,
        port: legacyServerProperties.port || 25565,
        memoryMb: 2048,
        motd: legacyServerProperties.motd || sanitized,
        serverPath: serverConfigDir,
        jarFile: "server.jar",
        createdAt: null,
      },
    };
  }

  async resolveBuildForCreate({ fork, versionInput }) {
    const normalizedFork = normalizeFork(fork, CREATE_SUPPORTED_FORKS);

    if (normalizedFork === "vanilla") {
      return this.resolveVanillaBuild(versionInput);
    }
    if (normalizedFork === "paper") {
      return this.resolvePaperBuild(versionInput);
    }
    if (normalizedFork === "purpur") {
      return this.resolvePurpurBuild(versionInput);
    }

    throw new Error(`Unsupported fork: ${normalizedFork}`);
  }

  async resolveVanillaBuild(versionInput) {
    const manifest = await this.fetchJson(VANILLA_VERSION_MANIFEST_URL);
    const requestedVersion = String(versionInput || "latest").trim().toLowerCase();
    const candidateVersion =
      requestedVersion === "latest" ? manifest?.latest?.release : versionInput;

    const versionEntry = manifest?.versions?.find(
      (entry) => entry.id === candidateVersion,
    );
    if (!versionEntry) {
      throw new Error(`Unknown Minecraft version "${versionInput}".`);
    }

    const versionMetadata = await this.fetchJson(versionEntry.url);
    const serverDownload = versionMetadata?.downloads?.server;
    if (!serverDownload?.url) {
      throw new Error(`Version "${versionEntry.id}" does not provide server jar.`);
    }

    return {
      fork: "vanilla",
      version: versionEntry.id,
      build: null,
      jarUrl: serverDownload.url,
    };
  }

  async resolvePaperBuild(versionInput) {
    const project = await this.fetchJson(PAPER_PROJECT_API_URL);
    const requestedVersion = String(versionInput || "latest").trim().toLowerCase();
    const targetVersion =
      requestedVersion === "latest"
        ? pickLatestMcVersion(project?.versions || [])
        : String(versionInput || "").trim();

    if (!project?.versions?.includes(targetVersion)) {
      throw new Error(`Paper does not support version "${versionInput}".`);
    }

    const buildsResponse = await this.fetchJson(
      `${PAPER_PROJECT_API_URL}/versions/${targetVersion}/builds`,
    );
    const rawBuilds = Array.isArray(buildsResponse?.builds)
      ? buildsResponse.builds
      : [];
    if (rawBuilds.length === 0) {
      throw new Error(`No Paper builds found for version "${targetVersion}".`);
    }

    const normalizedBuilds = rawBuilds
      .map((buildEntry) =>
        typeof buildEntry === "number"
          ? { build: buildEntry, channel: "default" }
          : buildEntry,
      )
      .filter((buildEntry) => Number.isInteger(buildEntry.build));

    const defaultChannelBuilds = normalizedBuilds.filter(
      (buildEntry) => buildEntry.channel === "default",
    );
    const candidateBuilds =
      defaultChannelBuilds.length > 0 ? defaultChannelBuilds : normalizedBuilds;

    const latestBuild = [...candidateBuilds].sort(
      (a, b) => a.build - b.build,
    ).at(-1);
    if (!latestBuild) {
      throw new Error(`No valid Paper build found for version "${targetVersion}".`);
    }

    const buildMeta = await this.fetchJson(
      `${PAPER_PROJECT_API_URL}/versions/${targetVersion}/builds/${latestBuild.build}`,
    );
    const downloadName = buildMeta?.downloads?.application?.name;
    if (!downloadName) {
      throw new Error(`Paper build metadata is missing application download.`);
    }

    return {
      fork: "paper",
      version: targetVersion,
      build: String(latestBuild.build),
      jarUrl: `${PAPER_PROJECT_API_URL}/versions/${targetVersion}/builds/${latestBuild.build}/downloads/${downloadName}`,
    };
  }

  async resolvePurpurBuild(versionInput) {
    const project = await this.fetchJson(PURPUR_PROJECT_API_URL);
    const requestedVersion = String(versionInput || "latest").trim().toLowerCase();
    const targetVersion =
      requestedVersion === "latest"
        ? project?.metadata?.current
        : String(versionInput || "").trim();

    if (!project?.versions?.includes(targetVersion)) {
      throw new Error(`Purpur does not support version "${versionInput}".`);
    }

    const buildMetadata = await this.fetchJson(
      `${PURPUR_PROJECT_API_URL}/${targetVersion}`,
    );
    const latestBuild = buildMetadata?.builds?.latest;
    if (!latestBuild) {
      throw new Error(`No Purpur build found for version "${targetVersion}".`);
    }

    return {
      fork: "purpur",
      version: targetVersion,
      build: String(latestBuild),
      jarUrl: `${PURPUR_PROJECT_API_URL}/${targetVersion}/${latestBuild}/download`,
    };
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
