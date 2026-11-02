/**
 * 型付きの簡易pub/subストア。フレームワークを使わない構成でのUI状態管理に使う。
 */

export type Listener<T> = (state: T) => void;
export type Unsubscribe = () => void;

export class Store<T> {
  private state: T;
  private readonly listeners = new Set<Listener<T>>();

  constructor(initialState: T) {
    this.state = initialState;
  }

  getState(): T {
    return this.state;
  }

  setState(next: T | ((prev: T) => T)): void {
    this.state = typeof next === 'function' ? (next as (prev: T) => T)(this.state) : next;
    this.notify();
  }

  /** 登録直後に現在の状態で一度呼ばれる(初期描画のため)。 */
  subscribe(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
