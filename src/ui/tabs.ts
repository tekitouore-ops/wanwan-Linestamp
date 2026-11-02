import { clearChildren, h } from '../shared/dom';
import type { Store } from '../shared/store';

export interface TabDefinition<TId extends string = string> {
  id: TId;
  label: string;
  /** パネルの内容を生成する。初回表示時に1回だけ呼ばれ、以降は同じ要素を再利用する。 */
  render: () => HTMLElement;
}

/**
 * タブの切替UIを構築する。選択状態は `store` が保持し、他の場所からも参照・変更できる。
 */
export function createTabs<TId extends string>(
  container: HTMLElement,
  tabs: Array<TabDefinition<TId>>,
  store: Store<TId>,
): void {
  const nav = h('div', { className: 'tabs__nav', attrs: { role: 'tablist' } });
  const panelContainer = h('div', { className: 'tabs__panel' });
  const buttons = new Map<TId, HTMLButtonElement>();
  const panels = new Map<TId, HTMLElement>();

  for (const tab of tabs) {
    const button = h('button', {
      className: 'tabs__button',
      attrs: { type: 'button', role: 'tab', 'aria-selected': 'false', id: `tab-${tab.id}` },
      text: tab.label,
      on: { click: () => store.setState(tab.id) },
    });
    buttons.set(tab.id, button);
    nav.append(button);
  }

  container.append(nav, panelContainer);

  store.subscribe((activeId) => {
    for (const [id, button] of buttons) {
      const isActive = id === activeId;
      button.classList.toggle('tabs__button--active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    }

    let panel = panels.get(activeId);
    if (!panel) {
      const tab = tabs.find((candidate) => candidate.id === activeId);
      panel = tab ? tab.render() : h('div', { text: '不明なタブです。' });
      panels.set(activeId, panel);
    }

    clearChildren(panelContainer);
    panelContainer.append(panel);
  });
}
