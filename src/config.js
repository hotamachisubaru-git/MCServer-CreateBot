import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const rawBaseDir = process.env.MC_BASE_DIR || "./servers";
const resolvedBaseDir = path.isAbsolute(rawBaseDir)
  ? rawBaseDir
  : path.resolve(projectRoot, rawBaseDir);

export const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
export const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || "";
export const MC_BASE_DIR = resolvedBaseDir;
export const JAVA_PATH = process.env.JAVA_PATH || "java";

export function assertEnv(keys) {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}
