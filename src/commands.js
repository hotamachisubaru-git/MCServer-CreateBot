import { SlashCommandBuilder } from "discord.js";

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("mc-wizard")
    .setDescription("対話形式でMinecraftサーバーの作成/既存追加を行います。"),

  new SlashCommandBuilder()
    .setName("mc-start")
    .setDescription("管理対象のMinecraftサーバーを起動します。")
    .addStringOption((option) =>
      option
        .setName("server")
        .setDescription("サーバー名")
        .setAutocomplete(true)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("memory")
        .setDescription("メモリ(MB) 上書き")
        .setMinValue(512)
        .setMaxValue(65536)
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("mc-stop")
    .setDescription("起動中のMinecraftサーバーを停止します。")
    .addStringOption((option) =>
      option
        .setName("server")
        .setDescription("サーバー名")
        .setAutocomplete(true)
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("mc-status")
    .setDescription("Minecraftサーバーの状態を表示します。")
    .addStringOption((option) =>
      option
        .setName("server")
        .setDescription("サーバー名")
        .setAutocomplete(true)
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("mc-list")
    .setDescription("管理対象のMinecraftサーバー一覧を表示します。"),

  new SlashCommandBuilder()
    .setName("mc-logs")
    .setDescription("Minecraftサーバーの最新ログを表示します。")
    .addStringOption((option) =>
      option
        .setName("server")
        .setDescription("サーバー名")
        .setAutocomplete(true)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("lines")
        .setDescription("表示行数")
        .setMinValue(1)
        .setMaxValue(80)
        .setRequired(false),
    ),
];

export const commandPayload = commandBuilders.map((builder) => builder.toJSON());
