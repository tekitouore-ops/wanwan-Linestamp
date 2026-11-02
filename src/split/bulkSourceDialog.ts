import { h } from '../shared/dom';
import type { Sheet } from './types';

export type BulkSourceMode = 'all' | 'odd' | 'even' | 'warning';

const MODE_OPTIONS: ReadonlyArray<{ value: BulkSourceMode; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'odd', label: '奇数番だけ(No.1, 3, 5…)' },
  { value: 'even', label: '偶数番だけ(No.2, 4, 6…)' },
  { value: 'warning', label: '空の枠・警告のある枠だけ' },
];

export interface BulkSourceDialogCallbacks {
  onApply: (sheetId: string, mode: BulkSourceMode) => void;
}

export interface BulkSourceDialogHandle {
  element: HTMLElement;
  open: (sheets: Sheet[]) => void;
}

/** 「採用元をまとめて設定…」ダイアログ(B-2仕様)。 */
export function createBulkSourceDialog(
  callbacks: BulkSourceDialogCallbacks,
): BulkSourceDialogHandle {
  const sheetSelect = h('select', {});
  const modeSelect = h('select', {});
  MODE_OPTIONS.forEach((option) => {
    modeSelect.append(h('option', { attrs: { value: option.value }, text: option.label }));
  });

  const dialog = h('dialog', { className: 'apply-all-dialog' }, [
    h('h2', { text: '採用元をまとめて設定' }),
    h('div', { className: 'field' }, [
      h('label', { className: 'field__label', text: '採用元にするシート' }),
      sheetSelect,
    ]),
    h('div', { className: 'field' }, [
      h('label', { className: 'field__label', text: '対象のスタンプ' }),
      modeSelect,
    ]),
    h('div', { className: 'csv-dialog__actions' }, [
      h('button', {
        className: 'button',
        attrs: { type: 'button' },
        text: 'キャンセル',
        on: { click: () => dialog.close() },
      }),
      h('button', {
        className: 'button button--primary',
        attrs: { type: 'button' },
        text: '適用',
        on: {
          click: () => {
            const sheetId = sheetSelect.value;
            if (!sheetId) {
              return;
            }
            callbacks.onApply(sheetId, modeSelect.value as BulkSourceMode);
            dialog.close();
          },
        },
      }),
    ]),
  ]);
  document.body.append(dialog);

  function open(sheets: Sheet[]): void {
    sheetSelect.replaceChildren();
    sheets.forEach((sheet, i) => {
      sheetSelect.append(
        h('option', { attrs: { value: sheet.id }, text: `S${i + 1} ${sheet.name}` }),
      );
    });
    dialog.showModal();
  }

  return { element: dialog, open };
}
