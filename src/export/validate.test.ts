import { describe, expect, it } from 'vitest';
import { validateDimensions, validateEmptyCells, validateFileSize } from './validate';

describe('validateDimensions', () => {
  it('規格内のサイズでは問題なし', () => {
    expect(validateDimensions(0, 370, 320, 370, 320)).toEqual([]);
  });

  it('最大サイズを超えると警告する', () => {
    const issues = validateDimensions(0, 400, 320, 370, 320);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('超えています');
  });

  it('奇数のときは警告する', () => {
    const issues = validateDimensions(0, 371, 321, 370, 320);
    expect(issues.some((i) => i.message.includes('偶数'))).toBe(true);
  });
});

describe('validateFileSize', () => {
  it('上限以下なら問題なし', () => {
    expect(validateFileSize(0, 1024 * 1024, 1024 * 1024)).toEqual([]);
  });

  it('上限を超えると警告する', () => {
    const issues = validateFileSize(0, 1024 * 1024 + 1, 1024 * 1024);
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
