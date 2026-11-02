export interface ValidationIssue {
  /** 0始まりのスタンプ番号。全体に関する問題はnull。 */
  index: number | null;
  message: string;
}

/** 画像サイズが規格の最大値以下か、幅・高さが偶数かを検証する。 */
export function validateDimensions(
  index: number,
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (width > maxWidth || height > maxHeight) {
    issues.push({
      index,
      message: `No.${index + 1}: サイズが規格(${maxWidth}×${maxHeight})を超えています(${width}×${height})。`,
    });
  }
  if (width % 2 !== 0 || height % 2 !== 0) {
    issues.push({
      index,
      message: `No.${index + 1}: 幅・高さが偶数ではありません(${width}×${height})。`,
    });
  }
  return issues;
}

/** PNGファイルの容量が上限を超えていないかを検証する。 */
export function validateFileSize(
  index: number,
  byteSize: number,
  maxBytes: number,
): ValidationIssue[] {
  if (byteSize > maxBytes) {
    const sizeKb = Math.round(byteSize / 1024);
    const maxKb = Math.round(maxBytes / 1024);
    return [
      {
        index,
        message: `No.${index + 1}: ファイルサイズが上限(${maxKb}KB)を超えています(${sizeKb}KB)。`,
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
