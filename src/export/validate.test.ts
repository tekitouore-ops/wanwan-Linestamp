import { describe, expect, it } from 'vitest';
import { validateDimensions, validateEmptyCells, validateFileSize, validateOverflowingCells } from './validate';

describe('validateDimensions', () => {
  it('規格内のサイズでは問題なし', () => {
    expect(validateDimensions('No.1', 370, 320, 370, 320)).toEqual([]);
  });

  it('最大サイズを超えると警告する', () => {
    const issues = validateDimensions('No.1', 400, 320, 370, 320);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('超えています');
  });

  it('奇数のときは警告する', () => {
    const issues = validateDimensions('No.1', 371, 321, 370, 320);
    expect(issues.some((i) => i.message.includes('偶数'))).toBe(true);
  });

  it('ラベルをそのままメッセージに使う(メイン画像・タブ画像向け)', () => {
    const issues = validateDimensions('メイン画像', 241, 240, 240, 240);
    expect(issues[0]?.message).toContain('メイン画像');
  });

  it('indexを渡すとValidationIssue.indexに反映される', () => {
    const issues = validateDimensions('No.3', 400, 320, 370, 320, 2);
    expect(issues[0]?.index).toBe(2);
  });
});

describe('validateFileSize', () => {
  it('上限以下なら問題なし', () => {
    expect(validateFileSize('No.1', 1024 * 1024, 1024 * 1024)).toEqual([]);
  });

  it('上限を超えると警告する', () => {
    const issues = validateFileSize('No.1', 1024 * 1024 + 1, 1024 * 1024);
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
