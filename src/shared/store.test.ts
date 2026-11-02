import { describe, expect, it, vi } from 'vitest';
import { Store } from './store';

describe('Store', () => {
  it('初期状態を取得できる', () => {
    const store = new Store({ count: 0 });
    expect(store.getState()).toEqual({ count: 0 });
  });

  it('subscribeすると現在の状態で即座に1回通知される', () => {
    const store = new Store('prompt');
    const listener = vi.fn();
    store.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('prompt');
  });

  it('setStateで状態を更新すると購読者に新しい状態が通知される', () => {
    const store = new Store('prompt');
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState('split');
    expect(store.getState()).toBe('split');
    expect(listener).toHaveBeenLastCalledWith('split');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('関数形式のsetStateで直前の状態を参照できる', () => {
    const store = new Store(1);
    store.setState((prev) => prev + 1);
    expect(store.getState()).toBe(2);
  });

  it('unsubscribeした後は通知されない', () => {
    const store = new Store(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setState(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
