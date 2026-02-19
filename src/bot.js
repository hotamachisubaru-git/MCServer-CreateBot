import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  assertEnv,
  DISCORD_TOKEN,
  JAVA_PATH,
  MC_BASE_DIR,
} from "./config.js";
import { MinecraftManager } from "./minecraftManager.js";

const WIZARD_MODAL_ID = "mc_wizard_modal";
const BUTTON_CREATE_ID = "mc_wizard_create";
const BUTTON_CANCEL_ID = "mc_wizard_cancel";

function buildWizardModal() {
  const modal = new ModalBuilder()
    .setCustomId(WIZARD_MODAL_ID)
    .setTitle("Minecraft Wizard");

  const serverNameInput = new TextInputBuilder()
    .setCustomId("server_name")
    .setLabel("Server Name (3-32 chars, a-zA-Z0-9_-)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(32)
    .setPlaceholder("my-world");

  const versionInput = new TextInputBuilder()
    .setCustomId("version")
    .setLabel('Minecraft Version ("latest" or exact id)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("latest")
    .setValue("latest");

  const portInput = new TextInputBuilder()
    .setCustomId("port")
    .setLabel("Port (1024-65535)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("25565")
    .setValue("25565");

  const memoryInput = new TextInputBuilder()
    .setCustomId("memory_mb")
    .setLabel("Memory in MB (512-65536)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("2048")
    .setValue("2048");

  const motdInput = new TextInputBuilder()
    .setCustomId("motd")
    .setLabel("MOTD")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(59)
    .setPlaceholder("My Discord-created server");

  modal.addComponents(
    new ActionRowBuilder().addComponents(serverNameInput),
    new ActionRowBuilder().addComponents(versionInput),
    new ActionRowBuilder().addComponents(portInput),
    new ActionRowBuilder().addComponents(memoryInput),
    new ActionRowBuilder().addComponents(motdInput),
  );

  return modal;
}

function parseWizard(interaction) {
  const name = interaction.fields.getTextInputValue("server_name").trim();
  const version = interaction.fields.getTextInputValue("version").trim() || "latest";
  const portRaw = interaction.fields.getTextInputValue("port").trim();
  const memoryRaw = interaction.fields.getTextInputValue("memory_mb").trim();
  const motd = interaction.fields.getTextInputValue("motd").trim() || name;

  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(name)) {
    throw new Error(
      "Server name must be 3-32 chars and use only letters, numbers, _ or -.",
    );
  }

  const port = Number.parseInt(portRaw, 10);
  const memoryMb = Number.parseInt(memoryRaw, 10);

  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Port must be an integer between 1024 and 65535.");
  }

  if (!Number.isInteger(memoryMb) || memoryMb < 512 || memoryMb > 65536) {
    throw new Error("Memory must be an integer between 512 and 65536.");
  }

  return { name, version, port, memoryMb, motd };
}

function buildWizardSummary(data) {
  return [
    "Review the server settings below, then press **Create Server**.",
    "```",
    `name: ${data.name}`,
    `version: ${data.version}`,
    `port: ${data.port}`,
    `memoryMb: ${data.memoryMb}`,
    `motd: ${data.motd}`,
    "```",
  ].join("\n");
}

function buildWizardButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_CREATE_ID)
      .setLabel("Create Server")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(BUTTON_CANCEL_ID)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );
}

function formatStatus(status) {
  if (!status.exists) {
    return `Server \`${status.name}\` does not exist.`;
  }

  const lines = [
    `name: ${status.name}`,
    `running: ${status.running ? "yes" : "no"}`,
  ];

  if (status.config) {
    lines.push(`version: ${status.config.version}`);
    lines.push(`port: ${status.config.port}`);
    lines.push(`memoryMb: ${status.config.memoryMb}`);
  }

  if (status.running) {
    lines.push(`pid: ${status.pid ?? "unknown"}`);
    lines.push(`startedAt: ${status.startedAt}`);
  }

  return ["```", ...lines, "```"].join("\n");
}

async function main() {
  assertEnv(["DISCORD_TOKEN"]);

  const manager = new MinecraftManager({
    baseDir: MC_BASE_DIR,
    javaPath: JAVA_PATH,
  });
  await manager.init();

  const pendingWizardByUser = new Map();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (readyClient) => {
    // eslint-disable-next-line no-console
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const command = interaction.commandName;

        if (command === "mc-wizard") {
          await interaction.showModal(buildWizardModal());
          return;
        }

        if (command === "mc-list") {
          await interaction.deferReply({ ephemeral: true });
          const servers = await manager.listServers();
          if (servers.length === 0) {
            await interaction.editReply("No servers found.");
            return;
          }

          await interaction.editReply(
            ["Created servers:", ...servers.map((name) => `- \`${name}\``)].join("\n"),
          );
          return;
        }

        if (command === "mc-start") {
          await interaction.deferReply({ ephemeral: true });
          const name = interaction.options.getString("server", true);
          const memory = interaction.options.getInteger("memory");
          const started = await manager.startServer(name, memory);
          await interaction.editReply(
            `Started \`${started.name}\` (PID: ${started.pid ?? "unknown"}, memory: ${started.memoryMb}MB).`,
          );
          return;
        }

        if (command === "mc-stop") {
          await interaction.deferReply({ ephemeral: true });
          const name = interaction.options.getString("server", true);
          await manager.stopServer(name);
          await interaction.editReply(`Stopped \`${name}\`.`);
          return;
        }

        if (command === "mc-status") {
          await interaction.deferReply({ ephemeral: true });
          const name = interaction.options.getString("server", true);
          const status = await manager.getStatus(name);
          await interaction.editReply(formatStatus(status));
          return;
        }

        if (command === "mc-logs") {
          await interaction.deferReply({ ephemeral: true });
          const name = interaction.options.getString("server", true);
          const lines = interaction.options.getInteger("lines") || 20;
          const logs = await manager.getRecentLogs(name, lines);
          if (logs.length === 0) {
            await interaction.editReply("No logs available.");
            return;
          }

          const rendered = logs.join("\n");
          if (rendered.length > 1850) {
            await interaction.editReply(`Last ${logs.length} lines are too long for one message.`);
            return;
          }

          await interaction.editReply(`\`\`\`\n${rendered}\n\`\`\``);
          return;
        }
      }

      if (interaction.isModalSubmit() && interaction.customId === WIZARD_MODAL_ID) {
        const parsed = parseWizard(interaction);
        pendingWizardByUser.set(interaction.user.id, parsed);
        await interaction.reply({
          ephemeral: true,
          content: buildWizardSummary(parsed),
          components: [buildWizardButtons()],
        });
        return;
      }

      if (interaction.isButton()) {
        if (interaction.customId === BUTTON_CANCEL_ID) {
          pendingWizardByUser.delete(interaction.user.id);
          await interaction.update({
            content: "Wizard canceled.",
            components: [],
          });
          return;
        }

        if (interaction.customId === BUTTON_CREATE_ID) {
          const wizardData = pendingWizardByUser.get(interaction.user.id);
          if (!wizardData) {
            await interaction.reply({
              ephemeral: true,
              content: "No pending wizard data. Run /mc-wizard again.",
            });
            return;
          }

          await interaction.update({
            content: "Creating server... this may take a minute while downloading server.jar.",
            components: [],
          });

          try {
            const created = await manager.createServer(wizardData);
            pendingWizardByUser.delete(interaction.user.id);
            await interaction.followUp({
              ephemeral: true,
              content: [
                `Created server \`${created.name}\`.`,
                `Version: ${created.version}`,
                `Port: ${created.port}`,
                `Memory: ${created.memoryMb}MB`,
                "Use `/mc-start server:<name>` to start it.",
              ].join("\n"),
            });
          } catch (error) {
            await interaction.followUp({
              ephemeral: true,
              content: `Failed to create server: ${error.message}`,
            });
          }

          return;
        }
      }
    } catch (error) {
      const message = `Error: ${error.message || "Unknown error"}`;

      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ ephemeral: true, content: message });
        } else {
          await interaction.reply({ ephemeral: true, content: message });
        }
      }

      // eslint-disable-next-line no-console
      console.error(error);
    }
  });

  await client.login(DISCORD_TOKEN);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
