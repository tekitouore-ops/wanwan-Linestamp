#!/usr/bin/env node
// src/shared/lineSpec.ts の定数を、.mjsスクリプトから参照できるJSON
// (scripts/lineSpec.generated.json)として書き出す(追加修正指示書 第7弾 項目25)。
// `.mjs`からTSファイルを直接importできないため、二重管理(値のコピペ)を避ける目的で、
// 既存の devDependency である `typescript` のtranspileModule APIを使ってその場で変換する
// (新しい依存パッケージは追加しない)。`npm run verify:zip` の実行前に毎回走らせ、
// 値が古いまま使われないようにする。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, '..', 'src', 'shared', 'lineSpec.ts');
const outputPath = path.join(__dirname, 'lineSpec.generated.json');

const source = readFileSync(sourcePath, 'utf-8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});

const transpiledPath = path.join(__dirname, '.lineSpec.generated.mjs');
writeFileSync(transpiledPath, outputText);

// キャッシュを避けるため、クエリ文字列にタイムスタンプを付けてimportする。
const moduleExports = await import(`${pathToFileURL(transpiledPath).href}?t=${Date.now()}`);

const picked = {
  STAMP_COUNT: moduleExports.STAMP_COUNT,
  STAMP_MAX_WIDTH: moduleExports.STAMP_MAX_WIDTH,
  STAMP_MAX_HEIGHT: moduleExports.STAMP_MAX_HEIGHT,
  STAMP_MAX_FILE_SIZE_BYTES: moduleExports.STAMP_MAX_FILE_SIZE_BYTES,
  MAIN_IMAGE_SIZE: moduleExports.MAIN_IMAGE_SIZE,
  MAIN_IMAGE_FILE_NAME: moduleExports.MAIN_IMAGE_FILE_NAME,
  TAB_IMAGE_SIZE: moduleExports.TAB_IMAGE_SIZE,
  TAB_IMAGE_FILE_NAME: moduleExports.TAB_IMAGE_FILE_NAME,
};

const missing = Object.entries(picked).filter(([, value]) => value === undefined);
if (missing.length > 0) {
  throw new Error(
    `src/shared/lineSpec.tsから次の値を読み取れませんでした: ${missing.map(([key]) => key).join(', ')}`,
  );
}

writeFileSync(outputPath, JSON.stringify(picked, null, 2) + '\n');
console.log(`同期しました: ${path.relative(process.cwd(), outputPath)}`);
