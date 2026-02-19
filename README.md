# Minecraft管理Discord Bot

DiscordからローカルのMinecraftサーバーを管理するBotです。  
`/mc-wizard` でBotの質問に順番に答えると、最終確認後にサーバー作成または既存サーバー追加を実行します。

## 主な機能

- 対話形式ウィザード（作成/既存追加）
  - `/mc-wizard`
  - Botが質問を出し、ユーザーが回答して進行
  - 最終確認で実行
- 複数サーバー管理
  - `/mc-start`, `/mc-stop`, `/mc-status`, `/mc-logs` の `server` 引数はオートコンプリート対応
  - サーバーが複数ある場合、候補がドロップダウン表示される
- フォーク対応
  - `vanilla`
  - `paper`
  - `purpur`
- 既存サーバー追加（インポート）
  - 既存サーバーディレクトリのパスとjar名を指定して管理対象に追加

## 動作要件

- Node.js 20以上
- Java 17以上（`JAVA_PATH` で指定可能）
- Discord Botアプリ

## セットアップ

1. 依存関係をインストール

```bash
npm install
```

2. 環境変数ファイルを作成

```bash
copy .env.example .env
```

3. `.env` を設定

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_app_client_id
DISCORD_GUILD_ID=your_test_guild_id
MC_BASE_DIR=./servers
JAVA_PATH=java
```

- `DISCORD_GUILD_ID` を設定すると、テスト用Guildに即時反映されます。
- `DISCORD_GUILD_ID` を空にするとグローバル登録になります（反映に時間がかかる場合あり）。

4. スラッシュコマンド登録

```bash
npm run register
```

5. Bot起動

```bash
npm start
```

## コマンド一覧

- `/mc-wizard`
  - 対話形式で以下のどちらかを実行
  - 新規サーバー作成（vanilla/paper/purpur）
  - 既存サーバー追加（管理対象に登録）
- `/mc-list`
  - 管理対象サーバー一覧を表示
- `/mc-start server:<サーバー名> [memory:<MB>]`
  - サーバー起動
- `/mc-stop server:<サーバー名>`
  - サーバー停止
- `/mc-status server:<サーバー名>`
  - 状態確認
- `/mc-logs server:<サーバー名> [lines:<行数>]`
  - 最新ログ表示

## 保存される設定

`MC_BASE_DIR` 配下にサーバーごとの `bot-config.json` が作成されます。  
作成したサーバーは同ディレクトリ内に `server.jar`, `eula.txt`, `server.properties` も生成されます。

## 運用上の注意

- コマンド権限を制限しない場合、Discordサーバー内でBotコマンド実行権限を持つユーザーが操作できます。
- 外部接続が必要な場合は、ポート開放やファイアウォール設定が必要です。
- Minecraft関連の利用規約/EULA順守は運用者責任です。
