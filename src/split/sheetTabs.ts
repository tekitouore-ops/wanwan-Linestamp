import { h, isEditableEventTarget, shouldHandleEnter } from '../shared/dom';
import type { Sheet } from './types';

export interface SheetTabsCallbacks {
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (id: string, direction: 'up' | 'down') => void;
  onAddMore: () => void;
}

export interface SheetTabsHandle {
  element: HTMLElement;
  setSheets: (sheets: Sheet[], activeId: string | null) => void;
}

/** ステップAの画面上部、複数シートを切り替えるためのタブ一覧。シートが1枚のときも表示する(削除・追加のため)。 */
export function createSheetTabs(callbacks: SheetTabsCallbacks): SheetTabsHandle {
  const list = h('div', { className: 'sheet-tabs__list' });
  const addButton = h('button', {
    className: 'button sheet-tabs__add',
    attrs: { type: 'button' },
    text: '+ シートを追加',
    on: { click: () => callbacks.onAddMore() },
  });

  function setSheets(sheets: Sheet[], activeId: string | null): void {
    list.replaceChildren();
    sheets.forEach((sheet, index) => {
      const nameInput = h('input', {
        className: 'sheet-tabs__name',
        attrs: { type: 'text', 'aria-label': `シート${index + 1}の表示名` },
      });
      nameInput.value = sheet.name;
      nameInput.addEventListener('click', (event) => event.stopPropagation());
      nameInput.addEventListener('change', () =>
        callbacks.onRename(sheet.id, nameInput.value.trim() || sheet.name),
      );
      /**
       * 日本語名のIME変換を確定するEnterで、親タブの選択(keydownのバブリング)が
       * 誤って発火しないようにする。確定Enterのときだけ、入力を確定(blur)させる
       * (追加修正指示書 第8弾 項目27)。
       */
      let lastCompositionEndTime: number | null = null;
      nameInput.addEventListener('compositionend', (event) => {
        lastCompositionEndTime = event.timeStamp;
      });
      nameInput.addEventListener('keydown', (event) => {
        if (!shouldHandleEnter(event, lastCompositionEndTime)) {
          return;
        }
        event.preventDefault();
        nameInput.blur();
      });

      const upButton = h('button', {
        className: 'button button--text',
        attrs: { type: 'button', 'aria-label': '左へ移動', title: '左へ移動' },
        text: '←',
      });
      const downButton = h('button', {
        className: 'button button--text',
        attrs: { type: 'button', 'aria-label': '右へ移動', title: '右へ移動' },
        text: '→',
      });
      const deleteButton = h('button', {
        className: 'button button--text',
        attrs: { type: 'button', 'aria-label': `シート${index + 1}を削除` },
        text: '削除',
      });
      [upButton, downButton, deleteButton].forEach((button) => {
        button.addEventListener('click', (event) => event.stopPropagation());
      });
      upButton.addEventListener('click', () => callbacks.onReorder(sheet.id, 'up'));
      downButton.addEventListener('click', () => callbacks.onReorder(sheet.id, 'down'));
      deleteButton.addEventListener('click', () => callbacks.onDelete(sheet.id));

      const tab = h(
        'div',
        {
          className: `sheet-tabs__tab${sheet.id === activeId ? ' sheet-tabs__tab--active' : ''}`,
          attrs: { role: 'button', tabindex: '0' },
        },
        [
          h('span', { className: 'sheet-tabs__badge', text: `S${index + 1}` }),
          nameInput,
          h('div', { className: 'sheet-tabs__actions' }, [upButton, downButton, deleteButton]),
        ],
      );
      tab.addEventListener('click', () => callbacks.onSelect(sheet.id));
      tab.addEventListener('keydown', (event) => {
        // 名前欄(nameInput)でのEnter/スペース入力がバブリングしてきても、タブ選択扱いにしない
        // (日本語名のIME変換確定・スペース入力が、誤ってタブを選択してしまう不具合の防止。
        // 追加修正指示書 第8弾 項目27)。
        if (isEditableEventTarget(event.target)) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          callbacks.onSelect(sheet.id);
        }
      });
      list.append(tab);
    });
  }

  const element = h('div', { className: 'sheet-tabs' }, [list, addButton]);
  return { element, setSheets };
}
