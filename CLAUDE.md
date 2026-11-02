# CLAUDE.md

Claude Code(開発エージェント)がこのリポジトリで作業する際の方針をまとめたものです。

## プロジェクト概要

LINEスタンプ(静止画24枚セット)の制作を助けるブラウザ内ツール。参照画像と24個分の
「お題・状況・セリフ」からChatGPT向け日本語プロンプトを作る機能(タブ①)と、ChatGPTが
生成した6×4のスタンプシート画像を自動検出で24枚に切り出し、LINE規格のPNGにしてZIPで
書き出す機能(タブ②)を持つ。フレームワークを使わない素のTypeScript+DOM操作で実装し、
外部ネットワーク通信は一切行わない。

## コマンド一覧

```bash
npm install
npm run dev         # 開発サーバー
npm run build       # 本番ビルド
npm run preview     # ビルド結果のローカル確認
npm test            # Vitest
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm run format      # Prettier
```

## アーキテクチャ概要

```
ui/        共通UI部品(タブ、ボタン、スライダー、トースト、ドロップゾーン等)
prompt/    機能1: プロンプト生成
split/     機能2前半: シート画像の自動検出・エディタ
export/    機能2後半: 規格化・書き出し
shared/    共通基盤(lineSpec, imageData, store, dom, types)
```

依存は一方向: `ui` / `prompt` / `split` / `export` → `shared`。
`export` は `split` の型(bbox・エディタ結果)のみ参照してよい。`prompt` と `split` は互いに依存しない。

詳細なデータフロー・検出アルゴリズム・描画パイプラインは `docs/architecture.md` を参照。

## コーディング規約

- TypeScript `strict` を前提とする。`any` の乱用禁止(やむを得ない場合は理由をコメントで明記)。
- 画像処理の中核ロジックは、Canvas/DOMに依存しない純粋関数として書く。入出力は
  `{ width: number; height: number; data: Uint8ClampedArray }`(ImageData互換)を基本とする。
  Canvasへの描画・読み出しは `shared/imageData.ts` などの薄いラッパー層に閉じ込める。
- LINE規格に関する値(サイズ・容量上限・枚数・ファイル名規則等)は `shared/lineSpec.ts` に集約する。
  他の場所にマジックナンバーとして書かない。
- UI文言・エラーメッセージはすべて日本語。コメントは日本語で可。
- コメントは「なぜ」を書く場合のみ(自明なWhatの説明は書かない)。

## 禁止事項

- React/Vue等のUIフレームワークの導入。
- 外部ネットワーク通信、CDNからのスクリプト/フォント読み込み、アナリティクスの追加。
- 無断の依存パッケージ追加。許可されているのは vite / typescript / vitest / jszip /
  typescript-eslint系 / prettier のみ。これ以外が必要な場合は、理由を添えて先にユーザーに確認する。
- `any` の乱用。

## 作業ルール

- 仕様を変更した場合は `docs/spec.md` と `README.md` を同時に更新する。
- 設計判断(迷った点・採用した方針とその理由)は `docs/decisions.md` に日付付きで追記する。
- `git push` はユーザーからの明示的な指示があるまで行わない。コミットはローカルまでに留める。
- コミットは小さく分け、Conventional Commits(`feat:` / `fix:` / `docs:` / `chore:` / `test:` / `refactor:`)
  で書く。件名は日本語で可。
- 各Phase完了時は、次の形式で報告する。
  1. 実装した内容
  2. 動作確認の方法(コマンド・操作手順)
  3. 受け入れ基準のチェック結果
  4. 未解決事項・懸念
- 各Phase終了時点で `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` がすべて通る状態を保つ。
