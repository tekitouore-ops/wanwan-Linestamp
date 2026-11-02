import { STAMP_COUNT } from '../shared/lineSpec';
import { createEmptyRow, createEmptyRows, type StampRow } from './types';

export interface ParseRowsResult {
  rows: StampRow[];
  warnings: string[];
}

const HEADER_CELLS = ['お題', '状況', 'セリフ'];
const LEGACY_TOPIC_HEADER_CELL = 'お題';

/**
 * 1行目のセルに見出し語が含まれていればヘッダー行とみなす。
 * ExcelやGoogleスプレッドシートからの貼り付けはヘッダーの有無が揺れるため、簡易判定にとどめる。
 */
function looksLikeHeader(row: string[]): boolean {
  return row.some((cell) => HEADER_CELLS.includes(cell.trim()));
}

/**
 * 最初の行に含まれるタブ・カンマの数を比較し、多い方を区切り文字として採用する。
 * Excel/スプレッドシートからのコピーはタブ区切り、CSVファイルはカンマ区切りになることが多い。
 */
function detectDelimiter(text: string): ',' | '\t' {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  return tabCount > commaCount ? '\t' : ',';
}

/** 引用符・区切り文字・改行を含むセルに対応した簡易CSV/TSVパーサ。 */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * 行頭が `『` で始まり `』｜` を含む行が過半数なら、`『セリフ』｜状況` 形式の貼り付けとみなす。
 */
function looksLikeBracketFormat(text: string): boolean {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) {
    return false;
  }
  const matching = lines.filter((line) => line.startsWith('『') && line.includes('』｜'));
  return matching.length > lines.length / 2;
}

/**
 * `『セリフ』｜状況` 形式のテキストを1行ずつ取り込む。改行だけで行を分け、
 * セリフが空(`『』`)の行もそのまま空セリフとして取り込む。形式に合わない行は無視する。
 */
function parseBracketLines(text: string): StampRow[] {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const rows: StampRow[] = [];
  for (const line of lines) {
    if (!line.startsWith('『')) {
      continue;
    }
    const separatorIndex = line.indexOf('』｜');
    if (separatorIndex !== -1) {
      rows.push({
        line: line.slice(1, separatorIndex),
        situation: line.slice(separatorIndex + 2),
      });
    } else if (line.endsWith('』')) {
      rows.push({ line: line.slice(1, -1), situation: '' });
    }
  }
  return rows;
}

/** 24行ちょうどになるよう、超過分を切り捨て/不足分を空欄で補い、警告メッセージを添える。 */
function padToStampCount(rows: StampRow[], warnings: string[]): StampRow[] {
  let source = rows;
  if (source.length > STAMP_COUNT) {
    warnings.push(
      `${STAMP_COUNT}行を超える分は無視しました(貼り付けられた行数: ${source.length}行)。`,
    );
    source = source.slice(0, STAMP_COUNT);
  } else if (source.length < STAMP_COUNT) {
    warnings.push(
      `${STAMP_COUNT}行に満たないため、不足分は空欄にしました(貼り付けられた行数: ${source.length}行)。`,
    );
  }

  const result: StampRow[] = [];
  for (let i = 0; i < STAMP_COUNT; i += 1) {
    result.push(source[i] ?? createEmptyRow());
  }
  return result;
}

/**
 * 貼り付けテキストを、常に{@link STAMP_COUNT}行ちょうどのStampRow[]に変換する。
 * `『セリフ』｜状況` 形式、`セリフ,状況` の2列CSV/TSV、旧`お題,状況,セリフ`の3列形式(ヘッダーに
 * 「お題」があれば自動判定し、お題の列は捨てる)のいずれにも対応する。
 */
export function parseRows(input: string): ParseRowsResult {
  const warnings: string[] = [];
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  if (text.trim() === '') {
    return { rows: createEmptyRows(), warnings };
  }

  if (looksLikeBracketFormat(text)) {
    return { rows: padToStampCount(parseBracketLines(text), warnings), warnings };
  }

  const delimiter = detectDelimiter(text);
  let table = parseDelimited(text, delimiter).filter(
    (row) => !(row.length === 1 && (row[0] ?? '').trim() === ''),
  );

  let isLegacyThreeColumn = false;
  if (table.length > 0 && looksLikeHeader(table[0] ?? [])) {
    isLegacyThreeColumn = (table[0] ?? []).some((cell) => cell.trim() === LEGACY_TOPIC_HEADER_CELL);
    table = table.slice(1);
  }

  if (table.length > STAMP_COUNT) {
    warnings.push(
      `${STAMP_COUNT}行を超える分は無視しました(貼り付けられた行数: ${table.length}行)。`,
    );
    table = table.slice(0, STAMP_COUNT);
  } else if (table.length < STAMP_COUNT) {
    warnings.push(
      `${STAMP_COUNT}行に満たないため、不足分は空欄にしました(貼り付けられた行数: ${table.length}行)。`,
    );
  }

  const rows: StampRow[] = [];
  for (let i = 0; i < STAMP_COUNT; i += 1) {
    const cells = table[i] ?? [];
    if (isLegacyThreeColumn) {
      rows.push({ situation: (cells[1] ?? '').trim(), line: (cells[2] ?? '').trim() });
    } else {
      rows.push({ line: (cells[0] ?? '').trim(), situation: (cells[1] ?? '').trim() });
    }
  }

  if (isLegacyThreeColumn) {
    warnings.push(
      '旧形式(お題,状況,セリフ)のデータを読み込みました。お題の列は取り込まず、セリフと状況だけ反映しました。',
    );
  }

  return { rows, warnings };
}

/** 「CSVテンプレートをダウンロード」用の空テンプレート(ヘッダー+24行の空欄)。 */
export function buildCsvTemplate(): string {
  const header = 'セリフ,状況';
  const blankRow = ',';
  return [header, ...Array.from({ length: STAMP_COUNT }, () => blankRow)].join('\n');
}
