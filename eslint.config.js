import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 一時変数等で先頭に `_` を付けたものは未使用でも許容する。
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // scripts/配下はNode CLIスクリプト(追加修正指示書 第7弾 項目25)。
    // ブラウザ向けのsrc/とは異なりNodeのグローバルを使うため、ここだけ個別に許可する
    // (新しい依存パッケージ〈globals等〉を追加しないよう、リテラルで最小限だけ列挙する)。
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
