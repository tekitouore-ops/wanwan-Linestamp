#!/usr/bin/env node
// 書き出しZIPの自動検証スクリプト(追加修正指示書 第7弾 項目25)。
// 使い方: npm run verify:zip -- path/to/stamps_YYYYMMDD_HHMM.zip [--json]
// ツール本体(アプリ)とは独立した「第三者チェック」として、ZIPがLINEスタンプの規格に
// 合っているかを機械的に検査する。依存はjszipとNode標準モジュールのみ。

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';
import { checkZipFiles } from './zipChecks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = argv.slice(2);
  const jsonIndex = args.indexOf('--json');
  const asJson = jsonIndex !== -1;
  if (asJson) {
    args.splice(jsonIndex, 1);
  }
  const zipPath = args[0];
  return { zipPath, asJson };
}

function loadConstants() {
  const generatedPath = path.join(__dirname, 'lineSpec.generated.json');
  if (!existsSync(generatedPath)) {
    throw new Error(
      'scripts/lineSpec.generated.json が見つかりません。先に `node scripts/sync-line-spec.mjs` を実行してください' +
        '(`npm run verify:zip` は自動で実行します)。',
    );
  }
  return JSON.parse(readFileSync(generatedPath, 'utf-8'));
}

/** ZIPのバイト列から、`{ファイル名: Buffer}`のマップを作る(ディレクトリエントリは除く)。 */
export async function loadZipBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const filesByName = {};
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  for (const entry of entries) {
    filesByName[entry.name] = await entry.async('nodebuffer');
  }
  return filesByName;
}

async function loadZipFiles(zipPath) {
  return loadZipBuffer(readFileSync(zipPath));
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function levelLabel(level) {
  if (level === 'ng') return 'NG';
  if (level === 'caution') return '注意';
  return '情報';
}

function printReport(report) {
  console.log('ファイル構成:');
  if (report.structureIssues.length === 0) {
    console.log('  問題なし');
  } else {
    report.structureIssues.forEach((i) => console.log(`  [${levelLabel(i.level)}] ${i.message}`));
  }
  console.log('');

  console.log('ファイル別の判定:');
  const nameWidth = Math.max(8, ...report.files.map((f) => f.name.length));
  report.files.forEach((f) => {
    const judgement =
      f.issues.length === 0
        ? 'OK'
        : f.issues.map((i) => `[${levelLabel(i.level)}] ${i.message}`).join(' / ');
    console.log(`  ${f.name.padEnd(nameWidth)}  ${formatBytes(f.sizeBytes).padStart(9)}  ${judgement}`);
  });
  console.log('');

  console.log(`合計サイズ: ${formatBytes(report.totalSizeBytes)}`);
  console.log(`NG ${report.ngCount}件 / 注意 ${report.cautionCount}件`);
}

async function main() {
  const { zipPath, asJson } = parseArgs(process.argv);
  if (!zipPath) {
    console.error('使い方: npm run verify:zip -- path/to/stamps_YYYYMMDD_HHMM.zip [--json]');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(zipPath)) {
    console.error(`ファイルが見つかりません: ${zipPath}`);
    process.exitCode = 1;
    return;
  }

  const constants = loadConstants();
  const filesByName = await loadZipFiles(zipPath);
  const report = checkZipFiles(filesByName, constants);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  process.exitCode = report.ngCount > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(`検証中にエラーが発生しました: ${error.message}`);
  process.exitCode = 1;
});
