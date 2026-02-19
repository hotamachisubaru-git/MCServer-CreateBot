import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  StringSelectMenuBuilder,
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

const WIZARD_PREFIX = "mc_wizard";
const WIZARD_MODE_ID = `${WIZARD_PREFIX}:mode`;
const WIZARD_CANCEL_ID = `${WIZARD_PREFIX}:cancel`;
const WIZARD_ANSWER_PREFIX = `${WIZARD_PREFIX}:answer`;
const WIZARD_MODAL_PREFIX = `${WIZARD_PREFIX}:modal`;
const WIZARD_FORK_PREFIX = `${WIZARD_PREFIX}:fork`;
const WIZARD_CONFIRM_PREFIX = `${WIZARD_PREFIX}:confirm`;

const SESSION_TTL_MS = 30 * 60 * 1000;
const AUTOCOMPLETE_COMMANDS = new Set([
  "mc-start",
  "mc-stop",
  "mc-status",
  "mc-logs",
]);
const FORK_OPTIONS = [
  {
    value: "vanilla",
    label: "Vanilla",
    description: "公式のバニラサーバー",
  },
  {
    value: "paper",
    label: "Paper",
    description: "高性能なフォーク",
  },
  {
    value: "purpur",
    label: "Purpur",
    description: "Paper系フォーク",
  },
  {
    value: "custom",
    label: "Custom",
    description: "既存サーバー追加向け",
  },
];

const CREATE_FLOW = [
  {
    field: "fork",
    type: "fork_select",
    question:
      "質問 1/6: どのフォークで作成しますか？",
  },
  {
    field: "name",
    type: "modal_input",
    question:
      "質問 2/6: 管理名を入力してください（3-32文字、英数字と _ -）。",
    inputLabel: "サーバー名",
    placeholder: "my-server",
    maxLength: 32,
    required: true,
  },
  {
    field: "version",
    type: "modal_input",
    question:
      '質問 3/6: Minecraftバージョンを入力してください（例: 1.21.1 / latest）。',
    inputLabel: "バージョン",
    placeholder: "latest",
    maxLength: 32,
    required: true,
    defaultValue: "latest",
  },
  {
    field: "port",
    type: "modal_input",
    question: "質問 4/6: サーバーポートを入力してください（1024-65535）。",
    inputLabel: "ポート",
    placeholder: "25565",
    maxLength: 5,
    required: true,
    defaultValue: "25565",
  },
  {
    field: "memoryMb",
    type: "modal_input",
    question: "質問 5/6: メモリ(MB)を入力してください（512-65536）。",
    inputLabel: "メモリ(MB)",
    placeholder: "2048",
    maxLength: 5,
    required: true,
    defaultValue: "2048",
  },
  {
    field: "motd",
    type: "modal_input",
    question: "質問 6/6: MOTDを入力してください（空欄可）。",
    inputLabel: "MOTD",
    placeholder: "Discord Bot Managed Server",
    maxLength: 59,
    required: false,
    style: TextInputStyle.Paragraph,
  },
];

const IMPORT_FLOW = [
  {
    field: "name",
    type: "modal_input",
    question:
      "質問 1/6: 管理名を入力してください（3-32文字、英数字と _ -）。",
    inputLabel: "サーバー名",
    placeholder: "legacy-server",
    maxLength: 32,
    required: true,
  },
  {
    field: "sourcePath",
    type: "modal_input",
    question:
      "質問 2/6: 既存サーバーディレクトリのフルパスを入力してください。",
    inputLabel: "サーバーパス",
    placeholder: "D:\\servers\\world1",
    maxLength: 300,
    required: true,
  },
  {
    field: "jarFile",
    type: "modal_input",
    question:
      "質問 3/6: 起動に使うjarファイル名を入力してください（相対パス可）。",
    inputLabel: "jarファイル",
    placeholder: "server.jar",
    maxLength: 150,
    required: true,
    defaultValue: "server.jar",
  },
  {
    field: "fork",
    type: "fork_select",
    question:
      "質問 4/6: 既存サーバーのフォーク種別を選んでください。",
  },
  {
    field: "version",
    type: "modal_input",
    question:
      "質問 5/6: バージョンを入力してください（不明なら unknown）。",
    inputLabel: "バージョン",
    placeholder: "unknown",
    maxLength: 32,
    required: true,
    defaultValue: "unknown",
  },
  {
    field: "memoryMb",
    type: "modal_input",
    question: "質問 6/6: メモリ(MB)を入力してください（512-65536）。",
    inputLabel: "メモリ(MB)",
    placeholder: "2048",
    maxLength: 5,
    required: true,
    defaultValue: "2048",
  },
];

function sanitizeServerName(name) {
  const value = String(name || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(value)) {
    throw new Error(
      "サーバー名は3-32文字、英数字と _ - のみ使用できます。",
    );
  }
  return value;
}

function parseIntegerRange(value, label, min, max) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label}は ${min}-${max} の整数で入力してください。`);
  }
  return parsed;
}

function getFlow(mode) {
  if (mode === "create") {
    return CREATE_FLOW;
  }
  if (mode === "import") {
    return IMPORT_FLOW;
  }
  throw new Error("不正なモードです。");
}

function createInitialSession() {
  return {
    mode: null,
    stepIndex: 0,
    data: {},
    updatedAt: Date.now(),
  };
}

function pruneSessions(sessionMap) {
  const now = Date.now();
  for (const [userId, session] of sessionMap.entries()) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      sessionMap.delete(userId);
    }
  }
}

function touchSession(session) {
  session.updatedAt = Date.now();
}

function buildModePrompt() {
  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId(WIZARD_MODE_ID)
    .setPlaceholder("作業を選択してください")
    .addOptions([
      {
        label: "新規作成",
        value: "create",
        description: "バニラ/Paper/Purpurから作成",
      },
      {
        label: "既存サーバー追加",
        value: "import",
        description: "既存ディレクトリを管理対象へ追加",
      },
    ]);

  return {
    content:
      "Minecraft管理ウィザードを開始します。\n質問 0/6: 何をしますか？",
    components: [
      new ActionRowBuilder().addComponents(modeSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(WIZARD_CANCEL_ID)
          .setLabel("中止")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function getCurrentStep(session) {
  const flow = getFlow(session.mode);
  return flow[session.stepIndex] || null;
}

function buildForkSelect(mode, stepIndex) {
  const options =
    mode === "create"
      ? FORK_OPTIONS.filter((fork) => fork.value !== "custom")
      : FORK_OPTIONS;

  return new StringSelectMenuBuilder()
    .setCustomId(`${WIZARD_FORK_PREFIX}:${mode}:${stepIndex}`)
    .setPlaceholder("フォークを選択")
    .addOptions(
      options.map((fork) => ({
        label: fork.label,
        value: fork.value,
        description: fork.description,
      })),
    );
}

function buildQuestionPrompt(session) {
  const step = getCurrentStep(session);
  if (!step) {
    return buildConfirmationPrompt(session);
  }

  if (step.type === "fork_select") {
    return {
      content: step.question,
      components: [
        new ActionRowBuilder().addComponents(
          buildForkSelect(session.mode, session.stepIndex),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(WIZARD_CANCEL_ID)
            .setLabel("中止")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    };
  }

  return {
    content: `${step.question}\n下の「回答する」を押して入力してください。`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `${WIZARD_ANSWER_PREFIX}:${session.mode}:${step.field}:${session.stepIndex}`,
          )
          .setLabel("回答する")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(WIZARD_CANCEL_ID)
          .setLabel("中止")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildSummaryLines(session) {
  if (session.mode === "create") {
    return [
      `mode: create`,
      `fork: ${session.data.fork}`,
      `name: ${session.data.name}`,
      `version: ${session.data.version}`,
      `port: ${session.data.port}`,
      `memoryMb: ${session.data.memoryMb}`,
      `motd: ${session.data.motd || session.data.name}`,
    ];
  }

  return [
    `mode: import`,
    `name: ${session.data.name}`,
    `sourcePath: ${session.data.sourcePath}`,
    `jarFile: ${session.data.jarFile}`,
    `fork: ${session.data.fork}`,
    `version: ${session.data.version}`,
    `memoryMb: ${session.data.memoryMb}`,
  ];
}

function buildConfirmationPrompt(session) {
  return {
    content: [
      "すべての質問が完了しました。以下の内容で実行します。",
      "```",
      ...buildSummaryLines(session),
      "```",
      "問題なければ「実行」を押してください。",
    ].join("\n"),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `${WIZARD_CONFIRM_PREFIX}:${session.mode}:${session.stepIndex}`,
          )
          .setLabel("実行")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(WIZARD_CANCEL_ID)
          .setLabel("中止")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildAnswerModal(session, step) {
  const customId = `${WIZARD_MODAL_PREFIX}:${session.mode}:${step.field}:${session.stepIndex}`;
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle("ウィザード回答");

  const textInput = new TextInputBuilder()
    .setCustomId("answer")
    .setLabel(step.inputLabel)
    .setStyle(step.style || TextInputStyle.Short)
    .setRequired(step.required !== false)
    .setMaxLength(step.maxLength || 120);

  if (step.placeholder) {
    textInput.setPlaceholder(step.placeholder);
  }

  const stepDefault =
    session.data[step.field] ??
    step.defaultValue ??
    (step.field === "motd" ? session.data.name || "" : "");
  const defaultValue = String(stepDefault || "");
  if (defaultValue) {
    textInput.setValue(defaultValue.slice(0, step.maxLength || 120));
  }

  return modal.addComponents(new ActionRowBuilder().addComponents(textInput));
}

function parseCustomId(rawCustomId, prefix) {
  const head = `${prefix}:`;
  if (!rawCustomId.startsWith(head)) {
    return null;
  }
  return rawCustomId.slice(head.length).split(":");
}

function assertActiveSession(sessionMap, userId) {
  const session = sessionMap.get(userId);
  if (!session) {
    throw new Error("対話セッションが見つかりません。`/mc-wizard` を再実行してください。");
  }
  return session;
}

function assertSessionPosition(session, mode, stepIndex, field = null) {
  if (session.mode !== mode) {
    throw new Error("古い操作です。`/mc-wizard` からやり直してください。");
  }
  if (session.stepIndex !== stepIndex) {
    throw new Error("進行が変わりました。最新の質問メッセージを使ってください。");
  }
  if (field) {
    const step = getCurrentStep(session);
    if (!step || step.field !== field) {
      throw new Error("この回答は現在の質問と一致しません。");
    }
  }
}

function normalizeStepValue(field, rawValue) {
  const value = String(rawValue || "").trim();
  if (field === "motd") {
    return value;
  }
  if (!value) {
    throw new Error("空欄は入力できません。");
  }
  return value;
}

function parseCreatePayload(data) {
  const fork = String(data.fork || "").trim().toLowerCase();
  if (!["vanilla", "paper", "purpur"].includes(fork)) {
    throw new Error("作成時のフォークは vanilla / paper / purpur のみ対応です。");
  }

  return {
    name: sanitizeServerName(data.name),
    fork,
    version: String(data.version || "latest").trim() || "latest",
    port: parseIntegerRange(data.port, "ポート", 1024, 65535),
    memoryMb: parseIntegerRange(data.memoryMb, "メモリ", 512, 65536),
    motd: String(data.motd || data.name || "").trim() || sanitizeServerName(data.name),
  };
}

function parseImportPayload(data) {
  const fork = String(data.fork || "custom").trim().toLowerCase();
  if (!["vanilla", "paper", "purpur", "custom"].includes(fork)) {
    throw new Error("既存追加のフォークは vanilla / paper / purpur / custom です。");
  }

  const sourcePath = String(data.sourcePath || "").trim();
  if (!sourcePath) {
    throw new Error("サーバーパスを入力してください。");
  }

  return {
    name: sanitizeServerName(data.name),
    sourcePath,
    jarFile: String(data.jarFile || "server.jar").trim() || "server.jar",
    fork,
    version: String(data.version || "unknown").trim() || "unknown",
    memoryMb: parseIntegerRange(data.memoryMb, "メモリ", 512, 65536),
  };
}

function formatStatus(status) {
  if (!status.exists) {
    return `サーバー \`${status.name}\` は管理対象に存在しません。`;
  }

  const cfg = status.config || {};
  const lines = [
    `name: ${status.name}`,
    `running: ${status.running ? "yes" : "no"}`,
    `source: ${cfg.source || "unknown"}`,
    `fork: ${cfg.fork || "unknown"}`,
    `version: ${cfg.version || "unknown"}`,
    `port: ${cfg.port || "unknown"}`,
    `memoryMb: ${cfg.memoryMb || "unknown"}`,
    `jarFile: ${cfg.jarFile || "server.jar"}`,
    `serverPath: ${cfg.serverPath || "unknown"}`,
  ];

  if (status.running) {
    lines.push(`pid: ${status.pid ?? "unknown"}`);
    lines.push(`startedAt: ${status.startedAt || "unknown"}`);
  }

  return ["```", ...lines, "```"].join("\n");
}

async function sendWizardPrompt(interaction, payload) {
  if (interaction.isMessageComponent()) {
    await interaction.update(payload);
    return;
  }

  await interaction.reply({
    ephemeral: true,
    ...payload,
  });
}

async function handleWizardConfirm(interaction, manager, sessionMap, session) {
  const payload =
    session.mode === "create"
      ? parseCreatePayload(session.data)
      : parseImportPayload(session.data);

  await interaction.update({
    content: "実行中です。完了まで少し待ってください...",
    components: [],
  });

  try {
    const result =
      session.mode === "create"
        ? await manager.createServer(payload)
        : await manager.importServer(payload);

    sessionMap.delete(interaction.user.id);
    await interaction.followUp({
      ephemeral: true,
      content:
        session.mode === "create"
          ? [
              `作成完了: \`${result.name}\``,
              `fork: ${result.fork}`,
              `version: ${result.version}`,
              `port: ${result.port}`,
              `memoryMb: ${result.memoryMb}`,
              "起動は `/mc-start` を使ってください。",
            ].join("\n")
          : [
              `既存サーバー追加完了: \`${result.name}\``,
              `sourcePath: ${result.serverPath}`,
              `jarFile: ${result.jarFile}`,
              `fork: ${result.fork}`,
              `version: ${result.version}`,
              "起動は `/mc-start` を使ってください。",
            ].join("\n"),
    });
  } catch (error) {
    sessionMap.delete(interaction.user.id);
    await interaction.followUp({
      ephemeral: true,
      content: `処理に失敗しました: ${error.message}`,
    });
  }
}

async function main() {
  assertEnv(["DISCORD_TOKEN"]);

  const manager = new MinecraftManager({
    baseDir: MC_BASE_DIR,
    javaPath: JAVA_PATH,
  });
  await manager.init();

  const wizardSessionByUser = new Map();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (readyClient) => {
    // eslint-disable-next-line no-console
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      pruneSessions(wizardSessionByUser);

      if (interaction.isAutocomplete()) {
        if (!AUTOCOMPLETE_COMMANDS.has(interaction.commandName)) {
          return;
        }

        const focused = String(interaction.options.getFocused() || "").toLowerCase();
        const serverNames = await manager.listServers();
        const choices = serverNames
          .filter((name) => name.toLowerCase().includes(focused))
          .slice(0, 25)
          .map((name) => ({ name, value: name }));
        await interaction.respond(choices);
        return;
      }

      if (interaction.isChatInputCommand()) {
        const command = interaction.commandName;

        if (command === "mc-wizard") {
          wizardSessionByUser.set(interaction.user.id, createInitialSession());
          await interaction.reply({
            ephemeral: true,
            ...buildModePrompt(),
          });
          return;
        }

        if (command === "mc-list") {
          await interaction.deferReply({ ephemeral: true });
          const servers = await manager.listServersDetailed();
          if (servers.length === 0) {
            await interaction.editReply("管理対象サーバーはありません。");
            return;
          }

          const lines = [
            "管理対象サーバー一覧:",
            ...servers.map(
              (server) =>
                `- \`${server.name}\` | ${server.fork}/${server.version} | ${server.source} | running:${server.running ? "yes" : "no"}`,
            ),
          ];
          await interaction.editReply(lines.join("\n"));
          return;
        }

        if (command === "mc-start") {
          await interaction.deferReply({ ephemeral: true });
          const name = interaction.options.getString("server", true);
          const memory = interaction.options.getInteger("memory");
          const started = await manager.startServer(name, memory);
          await interaction.editReply(
            `起動しました: \`${started.name}\` (PID: ${started.pid ?? "unknown"}, memory: ${started.memoryMb}MB)`,
          );
          return;
        }

        if (command === "mc-stop") {
          await interaction.deferReply({ ephemeral: true });
          const name = interaction.options.getString("server", true);
          await manager.stopServer(name);
          await interaction.editReply(`停止しました: \`${name}\``);
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
            await interaction.editReply("ログがありません。");
            return;
          }

          const rendered = logs.join("\n");
          if (rendered.length > 1850) {
            await interaction.editReply(
              `ログが長すぎるため表示できません（${logs.length}行）。`,
            );
            return;
          }

          await interaction.editReply(`\`\`\`\n${rendered}\n\`\`\``);
          return;
        }
      }

      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === WIZARD_MODE_ID) {
          const session = assertActiveSession(wizardSessionByUser, interaction.user.id);
          const mode = interaction.values?.[0];
          if (!["create", "import"].includes(mode)) {
            throw new Error("不正な選択です。");
          }

          session.mode = mode;
          session.stepIndex = 0;
          session.data = {};
          touchSession(session);

          await sendWizardPrompt(interaction, buildQuestionPrompt(session));
          return;
        }

        const forkParts = parseCustomId(interaction.customId, WIZARD_FORK_PREFIX);
        if (forkParts) {
          const [mode, stepRaw] = forkParts;
          const stepIndex = Number.parseInt(stepRaw, 10);
          const session = assertActiveSession(wizardSessionByUser, interaction.user.id);
          assertSessionPosition(session, mode, stepIndex, "fork");

          const selectedFork = interaction.values?.[0];
          if (!selectedFork) {
            throw new Error("フォークを選択してください。");
          }

          session.data.fork = selectedFork;
          session.stepIndex += 1;
          touchSession(session);

          await sendWizardPrompt(interaction, buildQuestionPrompt(session));
          return;
        }
      }

      if (interaction.isButton()) {
        if (interaction.customId === WIZARD_CANCEL_ID) {
          wizardSessionByUser.delete(interaction.user.id);
          await interaction.update({
            content: "ウィザードを中止しました。",
            components: [],
          });
          return;
        }

        const answerParts = parseCustomId(interaction.customId, WIZARD_ANSWER_PREFIX);
        if (answerParts) {
          const [mode, field, stepRaw] = answerParts;
          const stepIndex = Number.parseInt(stepRaw, 10);
          const session = assertActiveSession(wizardSessionByUser, interaction.user.id);
          assertSessionPosition(session, mode, stepIndex, field);

          const step = getCurrentStep(session);
          if (!step || step.type !== "modal_input") {
            throw new Error("現在の質問はモーダル入力ではありません。");
          }

          touchSession(session);
          await interaction.showModal(buildAnswerModal(session, step));
          return;
        }

        const confirmParts = parseCustomId(interaction.customId, WIZARD_CONFIRM_PREFIX);
        if (confirmParts) {
          const [mode, stepRaw] = confirmParts;
          const stepIndex = Number.parseInt(stepRaw, 10);
          const session = assertActiveSession(wizardSessionByUser, interaction.user.id);
          assertSessionPosition(session, mode, stepIndex);
          const currentStep = getCurrentStep(session);
          if (currentStep) {
            throw new Error("まだ質問が残っています。");
          }

          touchSession(session);
          await handleWizardConfirm(
            interaction,
            manager,
            wizardSessionByUser,
            session,
          );
          return;
        }
      }

      if (interaction.isModalSubmit()) {
        const modalParts = parseCustomId(interaction.customId, WIZARD_MODAL_PREFIX);
        if (modalParts) {
          const [mode, field, stepRaw] = modalParts;
          const stepIndex = Number.parseInt(stepRaw, 10);
          const session = assertActiveSession(wizardSessionByUser, interaction.user.id);
          assertSessionPosition(session, mode, stepIndex, field);

          const rawAnswer = interaction.fields.getTextInputValue("answer");
          session.data[field] = normalizeStepValue(field, rawAnswer);
          session.stepIndex += 1;
          touchSession(session);

          await interaction.reply({
            ephemeral: true,
            ...buildQuestionPrompt(session),
          });
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
