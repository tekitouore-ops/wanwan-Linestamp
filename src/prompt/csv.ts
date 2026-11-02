import { STAMP_COUNT } from '../shared/lineSpec';
import { createEmptyRows, type StampRow } from './types';

export interface ParseRowsResult {
  rows: StampRow[];
  warnings: string[];
}

const HEADER_CELLS = ['お題', '状況', 'セリフ'];

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
 * CSV/TSVテキストを、常に{@link STAMP_COUNT}行ちょうどのStampRow[]に変換する。
 * 超過分は無視し、不足分は空欄で埋める。どちらの場合も警告メッセージを返す。
 */
export function parseRows(input: string): ParseRowsResult {
  const warnings: string[] = [];
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  if (text.trim() === '') {
    return { rows: createEmptyRows(), warnings };
  }

  const delimiter = detectDelimiter(text);
  let table = parseDelimited(text, delimiter).filter(
    (row) => !(row.length === 1 && (row[0] ?? '').trim() === ''),
  );

  if (table.length > 0 && looksLikeHeader(table[0] ?? [])) {
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
    rows.push({
      topic: (cells[0] ?? '').trim(),
      situation: (cells[1] ?? '').trim(),
      line: (cells[2] ?? '').trim(),
    });
  }

  return { rows, warnings };
}

/** 「CSVテンプレートをダウンロード」用の空テンプレート(ヘッダー+24行の空欄)。 */
export function buildCsvTemplate(): string {
  const header = HEADER_CELLS.join(',');
  const blankRow = ',,';
  return [header, ...Array.from({ length: STAMP_COUNT }, () => blankRow)].join('\n');
}
