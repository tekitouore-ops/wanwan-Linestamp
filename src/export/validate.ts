export interface ValidationIssue {
  /** 0始まりのスタンプ番号。スタンプに紐づかない問題(メイン/タブ画像、全体の問題)はnull。 */
  index: number | null;
  message: string;
}

/** 画像サイズが規格の最大値以下か、幅・高さが偶数かを検証する。`label` はメッセージの先頭に使う(例: 「No.1」「メイン画像」)。 */
export function validateDimensions(
  label: string,
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
  index: number | null = null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (width > maxWidth || height > maxHeight) {
    issues.push({
      index,
      message: `${label}: サイズが規格(${maxWidth}×${maxHeight})を超えています(${width}×${height})。`,
    });
  }
  if (width % 2 !== 0 || height % 2 !== 0) {
    issues.push({
      index,
      message: `${label}: 幅・高さが偶数ではありません(${width}×${height})。`,
    });
  }
  return issues;
}

/** PNGファイルの容量が上限を超えていないかを検証する。 */
export function validateFileSize(
  label: string,
  byteSize: number,
  maxBytes: number,
  index: number | null = null,
): ValidationIssue[] {
  if (byteSize > maxBytes) {
    const sizeKb = Math.round(byteSize / 1024);
    const maxKb = Math.round(maxBytes / 1024);
    return [
      {
        index,
        message: `${label}: ファイルサイズが上限(${maxKb}KB)を超えています(${sizeKb}KB)。`,
      },
    ];
  }
  return [];
}

/** 空(内容なし)の枠がある場合に警告する。 */
export function validateEmptyCells(emptyIndexes: number[]): ValidationIssue[] {
  if (emptyIndexes.length === 0) {
    return [];
  }
  const numbers = emptyIndexes.map((i) => i + 1).join(', ');
  return [
    {
      index: null,
      message: `空(内容なし)のセルがあります(No. ${numbers})。このまま書き出すと空の画像になります。`,
    },
  ];
}

/** 被写体が出力キャンバスの外にはみ出して切れているスタンプを警告する。 */
export function validateOverflowingCells(overflowingIndexes: number[]): ValidationIssue[] {
  if (overflowingIndexes.length === 0) {
    return [];
  }
  const numbers = overflowingIndexes.map((i) => i + 1).join(', ');
  return [
    {
      index: null,
      message: `配置がキャンバスからはみ出しているスタンプがあります(No. ${numbers})。拡大率や位置を確認してください。`,
    },
  ];
}
