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
