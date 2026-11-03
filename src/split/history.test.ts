import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, createHistory, push, redo, undo } from './history';

describe('createHistory', () => {
  it('pastもfutureも空で、presentに初期値が入る', () => {
    const history = createHistory(1);
    expect(history).toEqual({ past: [], present: 1, future: [] });
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });
});

describe('push', () => {
  it('現在の状態をpastへ積み、新しい値をpresentにする', () => {
    const history = push(createHistory(1), 2);
    expect(history).toEqual({ past: [1], present: 2, future: [] });
  });

  it('複数回pushすると、pastに古い順で積まれる', () => {
    let history = createHistory(1);
    history = push(history, 2);
    history = push(history, 3);
    expect(history.past).toEqual([1, 2]);
    expect(history.present).toBe(3);
  });

  it('上限(cap)を超えると、最も古いものから捨てられる', () => {
    let history = createHistory(0);
    for (let i = 1; i <= 5; i += 1) {
      history = push(history, i, 3);
    }
    // 0,1,2,3,4 の5手→cap=3なので直近3つ(2,3,4)だけ残り、presentは5。
    expect(history.past).toEqual([2, 3, 4]);
    expect(history.present).toBe(5);
  });

  it('新しくpushすると、redo用のfutureは消える', () => {
    let history = createHistory(1);
    history = push(history, 2);
    history = undo(history);
    expect(history.future).toEqual([2]);
    history = push(history, 3);
    expect(history.future).toEqual([]);
    expect(history.present).toBe(3);
  });
});

describe('undo', () => {
  it('直前の状態に戻し、現在の状態をfutureへ積む', () => {
    let history = createHistory(1);
    history = push(history, 2);
    history = undo(history);
    expect(history).toEqual({ past: [], present: 1, future: [2] });
  });

  it('pastが空のときは何もしない(同じ履歴を返す)', () => {
    const history = createHistory(1);
    expect(undo(history)).toEqual(history);
  });

  it('複数回undoすると、pastの古い順にさかのぼる', () => {
    let history = createHistory(1);
    history = push(history, 2);
    history = push(history, 3);
    history = undo(history);
    history = undo(history);
    expect(history).toEqual({ past: [], present: 1, future: [2, 3] });
  });
});

describe('redo', () => {
  it('undoした状態をやり直し、pastへ戻す', () => {
    let history = createHistory(1);
    history = push(history, 2);
    history = undo(history);
    history = redo(history);
    expect(history).toEqual({ past: [1], present: 2, future: [] });
  });

  it('futureが空のときは何もしない(同じ履歴を返す)', () => {
    const history = createHistory(1);
    expect(redo(history)).toEqual(history);
  });
});

describe('canUndo / canRedo', () => {
  it('pastとfutureの有無だけを見る', () => {
    let history = createHistory(1);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);

    history = push(history, 2);
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);

    history = undo(history);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(true);
  });
});
