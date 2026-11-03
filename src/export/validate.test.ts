import { describe, expect, it } from 'vitest';
import {
  MAIN_IMAGE_SIZE,
  STAMP_MAX_FILE_SIZE_BYTES,
  STAMP_MAX_HEIGHT,
  STAMP_MAX_WIDTH,
  TAB_IMAGE_SIZE,
  UPSCALE_CAUTION_THRESHOLD,
  UPSCALE_WARNING_THRESHOLD,
} from '../shared/lineSpec';
import {
  summarizeUpscaleCaution,
  validateDimensions,
  validateEmptyCells,
  validateFileSize,
  validateMissingSourceSheet,
  validateOverflowingCells,
  validateUpscaleWarning,
} from './validate';

// 数値はすべてshared/lineSpec.tsの定数から取る(直書きしない)。定数を変更しても、
// このテストは追従して境界値を検証し続ける(修正指示書 項目5参照)。

describe('validateDimensions', () => {
  it('規格内のサイズでは問題なし', () => {
    expect(
      validateDimensions(
        'No.1',
        STAMP_MAX_WIDTH,
        STAMP_MAX_HEIGHT,
        STAMP_MAX_WIDTH,
        STAMP_MAX_HEIGHT,
      ),
    ).toEqual([]);
  });

  it('最大サイズを超えると警告する', () => {
    const issues = validateDimensions(
      'No.1',
      STAMP_MAX_WIDTH + 30,
      STAMP_MAX_HEIGHT,
      STAMP_MAX_WIDTH,
      STAMP_MAX_HEIGHT,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('超えています');
  });

  it('奇数のときは警告する', () => {
    const issues = validateDimensions(
      'No.1',
      STAMP_MAX_WIDTH + 1,
      STAMP_MAX_HEIGHT + 1,
      STAMP_MAX_WIDTH,
      STAMP_MAX_HEIGHT,
    );
    expect(issues.some((i) => i.message.includes('偶数'))).toBe(true);
  });

  it('ラベルをそのままメッセージに使う(メイン画像・タブ画像向け)', () => {
    const issues = validateDimensions(
      'メイン画像',
      MAIN_IMAGE_SIZE.width + 1,
      MAIN_IMAGE_SIZE.height,
      MAIN_IMAGE_SIZE.width,
      MAIN_IMAGE_SIZE.height,
    );
    expect(issues[0]?.message).toContain('メイン画像');
  });

  it('タブ画像のサイズでも検証できる', () => {
    expect(
      validateDimensions(
        'タブ画像',
        TAB_IMAGE_SIZE.width,
        TAB_IMAGE_SIZE.height,
        TAB_IMAGE_SIZE.width,
        TAB_IMAGE_SIZE.height,
      ),
    ).toEqual([]);
  });

  it('indexを渡すとValidationIssue.indexに反映される', () => {
    const issues = validateDimensions(
      'No.3',
      STAMP_MAX_WIDTH + 30,
      STAMP_MAX_HEIGHT,
      STAMP_MAX_WIDTH,
      STAMP_MAX_HEIGHT,
      2,
    );
    expect(issues[0]?.index).toBe(2);
  });
});

describe('validateFileSize', () => {
  it('上限以下なら問題なし', () => {
    expect(validateFileSize('No.1', STAMP_MAX_FILE_SIZE_BYTES, STAMP_MAX_FILE_SIZE_BYTES)).toEqual(
      [],
    );
  });

  it('上限を超えると警告する', () => {
    const issues = validateFileSize(
      'No.1',
      STAMP_MAX_FILE_SIZE_BYTES + 1,
      STAMP_MAX_FILE_SIZE_BYTES,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('上限');
  });
});

describe('validateEmptyCells', () => {
  it('空セルがなければ問題なし', () => {
    expect(validateEmptyCells([])).toEqual([]);
  });

  it('空セルがあれば番号を含めて警告する', () => {
    const issues = validateEmptyCells([0, 5]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('No. 1, 6');
  });
});

describe('validateOverflowingCells', () => {
  it('はみ出しがなければ問題なし', () => {
    expect(validateOverflowingCells([])).toEqual([]);
  });

  it('はみ出しがあれば番号を含めて警告する', () => {
    const issues = validateOverflowingCells([3]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('No. 4');
  });
});

describe('validateUpscaleWarning(追加修正指示書 項目12)', () => {
  it('警告段階のスタンプがなければ問題なし', () => {
    expect(validateUpscaleWarning([])).toEqual([]);
  });

  it('警告段階のスタンプがあれば番号を含めて警告する', () => {
    const issues = validateUpscaleWarning([0, 3]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('No. 1, 4');
  });
});

describe('summarizeUpscaleCaution(追加修正指示書 項目12)', () => {
  it('注意段階が0枚ならnull(件数のみの案内すら出さない)', () => {
    expect(summarizeUpscaleCaution(0)).toBeNull();
  });

  it('件数と、しきい値の定数値を含めた案内文を返す', () => {
    const message = summarizeUpscaleCaution(12);
    expect(message).toContain('12枚');
    expect(message).toContain(String(UPSCALE_CAUTION_THRESHOLD));
    expect(message).toContain(String(UPSCALE_WARNING_THRESHOLD));
  });
});

describe('validateMissingSourceSheet', () => {
  it('採用元が見つからないスタンプがなければ問題なし', () => {
    expect(validateMissingSourceSheet([])).toEqual([]);
  });

  it('採用元が見つからないスタンプがあれば番号を含めて警告する', () => {
    const issues = validateMissingSourceSheet([0, 2]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('No. 1, 3');
  });
});
