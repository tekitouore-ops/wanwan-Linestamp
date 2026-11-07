import { describe, expect, it } from 'vitest';
import { ENTER_AFTER_COMPOSITION_GRACE_MS, shouldHandleEnter } from './dom';

function makeEvent(overrides: Partial<Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode' | 'timeStamp'>> = {}) {
  return {
    key: 'Enter',
    isComposing: false,
    keyCode: 13,
    timeStamp: 1000,
    ...overrides,
  };
}

describe('shouldHandleEnter(追加修正指示書 第8弾 項目27)', () => {
  it('Enter以外のキーはfalse', () => {
    expect(shouldHandleEnter(makeEvent({ key: 'a' }), null)).toBe(false);
  });

  it('通常のEnter(IME変換中でない)はtrue', () => {
    expect(shouldHandleEnter(makeEvent(), null)).toBe(true);
  });

  it('isComposingがtrueのEnterはfalse(IME変換の確定Enter)', () => {
    expect(shouldHandleEnter(makeEvent({ isComposing: true }), null)).toBe(false);
  });

  it('keyCodeが229のEnterはfalse(IME変換中を示す値)', () => {
    expect(shouldHandleEnter(makeEvent({ isComposing: false, keyCode: 229 }), null)).toBe(false);
  });

  it('compositionend直後(50ms未満)のEnterはfalse(Safari対策)', () => {
    const lastCompositionEndTime = 1000;
    const event = makeEvent({ timeStamp: 1000 + ENTER_AFTER_COMPOSITION_GRACE_MS - 1 });
    expect(shouldHandleEnter(event, lastCompositionEndTime)).toBe(false);
  });

  it('compositionendから50ms以上経過したEnterはtrue', () => {
    const lastCompositionEndTime = 1000;
    const event = makeEvent({ timeStamp: 1000 + ENTER_AFTER_COMPOSITION_GRACE_MS });
    expect(shouldHandleEnter(event, lastCompositionEndTime)).toBe(true);
  });

  it('lastCompositionEndTimeがnull(compositionendが一度も発生していない)なら、猶予判定は行わない', () => {
    expect(shouldHandleEnter(makeEvent({ timeStamp: 0 }), null)).toBe(true);
  });
});
