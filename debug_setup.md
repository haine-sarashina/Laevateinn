# デバッグ環境の設定手順

## 環境変数の確認

1. `src-tauri/.env`ファイルに以下の内容が含まれていることを確認:

```env
GOOGLE_OAUTH_CLIENT_ID=639129931679-7afpgr8gmghsrvj9bvond5kk7040jikp.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=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
# Debug mode settings
DEBUG_GOOGLE_OAUTH_CLIENT_ID=1080880975921-74ip0d8jim7bh26cikmbafe15gjo3p43.apps.googleusercontent.com
DEBUG_GOOGLE_OAUTH_CLIENT_SECRET=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
DEBUG_MODE=true
```

## デバッグモードでの起動方法

```bash
# Windows (コマンドプロンプト)
set DEBUG_MODE=true && pnpm run tauri dev

# Windows (PowerShell)
$env:DEBUG_MODE="true"; pnpm run tauri dev

# Linux/macOS
DEBUG_MODE=true pnpm run tauri dev
```

## Googleの承認プロセスについて

- デバッグ用クライアントID `1080880975921-74ip0d8jim7bh26cikmbafe15gjo3p43.apps.googleusercontent.com` はまだ審査中
- テストユーザーの追加が必要です:
  1. Google Cloud Consoleにアクセス
  2. プロジェクトを選択
  3. OAuth同意画面でテストユーザーを追加
  4. アプリの承認プロセスを完了させる

## 開発時の回避策

開発中は以下の方法で通常のクライアントIDを使用できます:

```bash
# デバッグモードを無効にして通常のクライアントIDを使用
DEBUG_MODE=false pnpm run tauri dev
```