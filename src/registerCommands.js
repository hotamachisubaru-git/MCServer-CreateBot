import { REST, Routes } from "discord.js";
import {
  assertEnv,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  DISCORD_TOKEN,
} from "./config.js";
import { commandPayload } from "./commands.js";

async function main() {
  assertEnv(["DISCORD_TOKEN", "DISCORD_CLIENT_ID"]);

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  if (DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
      { body: commandPayload },
    );
    // eslint-disable-next-line no-console
    console.log(
      `Registered ${commandPayload.length} guild commands for guild ${DISCORD_GUILD_ID}.`,
    );
    return;
  }

  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
    body: commandPayload,
  });
  // eslint-disable-next-line no-console
  console.log(`Registered ${commandPayload.length} global commands.`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
