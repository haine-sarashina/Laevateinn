# Laevateinn Mail Client

## OAuthクライアント情報の設定

このアプリケーションはGoogle OAuthを使用して認証を行います。デフォルトでは以下のクライアント情報が使用されます:

- Client ID: `199450902096-mbc7ucd7777rtek56gnprac1mcfjobuk.apps.googleusercontent.com`
- Client Secret: `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`

**注意**: これらのデフォルトクライアントは、テスト目的で提供されています。実際の運用では、独自のGoogle Cloudプロジェクトを作成し、新しいOAuthクライアントを設定してください。

### 独自のOAuthクライアントを使用する場合

1. Google Cloud Consoleで新しいプロジェクトを作成
2. OAuthクライアントを設定
3. 環境変数を設定:

```
GOOGLE_OAUTH_CLIENT_ID=your_client_id_here
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret_here
```

または、`src-tauri/.env`ファイルに以下のように記述:

```
GOOGLE_OAUTH_CLIENT_ID=your_client_id_here
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret_here
```

### 既存のクライアント情報が削除された場合

エラー `401: deleted_client` が発生した場合は、以下の手順で対応してください:

1. Google Cloud Consoleにアクセス
2. 新しいOAuthクライアントを作成
3. 上記の環境変数を新しいクライアント情報に置き換える

## ビルド手順

```bash
# 開発サーバーの起動
pnpm run dev

# Tauri開発ビルド
pnpm run tauri dev

# Tauriリリースビルド
pnpm run tauri build
```

## 開発コマンド

- **フロントエンド開発**: `pnpm run dev`
- **Tauri 開発**: `pnpm run tauri dev`
- **Tauri ビルド**: `pnpm run tauri build`
- **リンティング**: `pnpm run lint`
