import { describe, expect, it } from 'vitest';
import { resolvePointerDownIntent } from './detectView';

describe('resolvePointerDownIntent', () => {
  it('スペース押下中は、左ボタンでの押下でもパンが優先される', () => {
    expect(resolvePointerDownIntent(true, 0)).toBe('pan');
  });

  it('スペース未押下・左ボタンなら、パン以外(枠選択等)の操作になる', () => {
    expect(resolvePointerDownIntent(false, 0)).toBe('other');
  });

  it('スペース未押下でも、ホイール(中)ボタンでの押下はパンになる', () => {
    expect(resolvePointerDownIntent(false, 1)).toBe('pan');
  });

  it('スペース押下中かつホイールボタンでも、パンのままである', () => {
    expect(resolvePointerDownIntent(true, 1)).toBe('pan');
  });
});
