import { SlashCommandBuilder } from "discord.js";

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("mc-wizard")
    .setDescription("Create a Minecraft server through an interactive wizard."),

  new SlashCommandBuilder()
    .setName("mc-start")
    .setDescription("Start a created Minecraft server.")
    .addStringOption((option) =>
      option
        .setName("server")
        .setDescription("Server name")
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("memory")
        .setDescription("Memory in MB (optional override)")
        .setMinValue(512)
        .setMaxValue(65536)
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("mc-stop")
    .setDescription("Stop a running Minecraft server.")
    .addStringOption((option) =>
      option
        .setName("server")
        .setDescription("Server name")
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("mc-status")
    .setDescription("Show status of a Minecraft server.")
    .addStringOption((option) =>
      option
        .setName("server")
        .setDescription("Server name")
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("mc-list")
    .setDescription("List all created Minecraft servers."),

  new SlashCommandBuilder()
    .setName("mc-logs")
    .setDescription("Show recent logs from a Minecraft server.")
    .addStringOption((option) =>
      option
        .setName("server")
        .setDescription("Server name")
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("lines")
        .setDescription("How many recent lines")
        .setMinValue(1)
        .setMaxValue(80)
        .setRequired(false),
    ),
];

export const commandPayload = commandBuilders.map((builder) => builder.toJSON());
