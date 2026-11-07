/**
 * フレームワークを使わずにDOM要素を組み立てるための薄いヘルパー。
 */

export interface ElementOptions {
  className?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
  text?: string;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (options.className) {
    el.className = options.className;
  }
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      el.setAttribute(key, value);
    }
  }
  if (options.on) {
    for (const [event, listener] of Object.entries(options.on)) {
      if (listener) {
        el.addEventListener(event, listener);
      }
    }
  }
  if (options.text !== undefined) {
    el.textContent = options.text;
  }
  for (const child of children) {
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }

  return el;
}

/** 要素の子要素をすべて取り除く(再描画時に使う)。 */
export function clearChildren(el: Element): void {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/**
 * テキスト入力など、キーボード操作が本来の編集対象になる要素か判定する。
 * スペースキーでのパンやCtrl+Zでのundoなど、画面全体のショートカットを
 * 文字入力中には発火させないためのガードに使う。
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** `shouldHandleEnter`に渡す、IME変換終了直後の猶予時間(ms、追加修正指示書 第8弾 項目27)。 */
export const ENTER_AFTER_COMPOSITION_GRACE_MS = 50;

/**
 * Enterキーの押下を「確定操作」(次の行へ移動する等)として扱ってよいか判定する(DOM非依存の
 * 純粋関数)。IME変換の確定Enterを、誤って次の操作として処理してしまう不具合を防ぐために使う
 * (追加修正指示書 第8弾 項目27)。
 *
 * - `event.isComposing`がtrue、または`event.keyCode`が229(IME変換中を示す値)なら、確定Enterと
 *   見なさない。
 * - Safariでは`compositionend`の直後に`isComposing`がfalseの`keydown(Enter)`が発火することが
 *   あるため、直近の`compositionend`から`ENTER_AFTER_COMPOSITION_GRACE_MS`(50ms)以内のEnterも
 *   確定Enterと見なさない。`lastCompositionEndTime`には、`compositionend`イベントの
 *   `event.timeStamp`を渡す(未発生ならnull)。
 */
export function shouldHandleEnter(
  event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode' | 'timeStamp'>,
  lastCompositionEndTime: number | null,
): boolean {
  if (event.key !== 'Enter') {
    return false;
  }
  if (event.isComposing || event.keyCode === 229) {
    return false;
  }
  if (
    lastCompositionEndTime !== null &&
    event.timeStamp - lastCompositionEndTime < ENTER_AFTER_COMPOSITION_GRACE_MS
  ) {
    return false;
  }
  return true;
}
