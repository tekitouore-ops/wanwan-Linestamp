import { h } from '../shared/dom';
import type { SheetAssignmentRow } from './sheetMatch';
import type { Sheet } from './types';

/** 「割り当てない」を表す特別な値(HTML selectのoption valueは文字列のみのため)。 */
const UNASSIGNED_VALUE = '';

export interface SheetAssignDialogCallbacks {
  /** savedSheetId → 割り当てた現在のシートid(「割り当てない」はnull)。 */
  onApply: (assignments: Record<string, string | null>) => void;
  /** 「画像を追加で読み込む」で選んだファイル。読み込み後、呼び出し側が`refreshCandidates`で候補を更新する。 */
  onAddMoreImages: (files: File[]) => void;
}

export interface SheetAssignDialogHandle {
  element: HTMLElement;
  open: (rows: SheetAssignmentRow[], currentSheets: Sheet[]) => void;
  /** シート追加後、ダイアログを開いたまま候補一覧(プルダウンの選択肢)だけを更新する。 */
  refreshCandidates: (rows: SheetAssignmentRow[], currentSheets: Sheet[]) => void;
}

interface RowHandle {
  savedSheetId: string;
  select: HTMLSelectElement;
  duplicateHint: HTMLElement;
}

/**
 * 設定JSON読込時、保存されていたシートと現在読み込み済みのシートを自動対応づけできなかった
 * 分について、手動で割り当てるダイアログ(修正指示書 項目1)。
 */
export function createSheetAssignDialog(callbacks: SheetAssignDialogCallbacks): SheetAssignDialogHandle {
  const rowsContainer = h('div', { className: 'sheet-assign-dialog__rows' });
  const rowHandles: RowHandle[] = [];

  const addMoreInput = h('input', {
    className: 'dropzone__input',
    attrs: { type: 'file', accept: 'image/*', multiple: 'multiple' },
  });
  addMoreInput.addEventListener('change', () => {
    const files = Array.from(addMoreInput.files ?? []);
    addMoreInput.value = '';
    if (files.length > 0) {
      callbacks.onAddMoreImages(files);
    }
  });

  const addMoreButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '画像を追加で読み込む',
    on: { click: () => addMoreInput.click() },
  });

  function checkDuplicates(): void {
    const countBySheetId = new Map<string, number>();
    rowHandles.forEach((row) => {
      if (row.select.value !== UNASSIGNED_VALUE) {
        countBySheetId.set(row.select.value, (countBySheetId.get(row.select.value) ?? 0) + 1);
      }
    });
    rowHandles.forEach((row) => {
      const isDuplicate = row.select.value !== UNASSIGNED_VALUE && (countBySheetId.get(row.select.value) ?? 0) > 1;
      row.duplicateHint.hidden = !isDuplicate;
    });
  }

  function buildOptions(select: HTMLSelectElement, currentSheets: Sheet[], selectedId: string | undefined): void {
    const previousValue = select.value || selectedId || UNASSIGNED_VALUE;
    select.replaceChildren();
    select.append(h('option', { attrs: { value: UNASSIGNED_VALUE }, text: '割り当てない' }));
    currentSheets.forEach((sheet) => {
      select.append(
        h('option', { attrs: { value: sheet.id }, text: `${sheet.name}(${sheet.width}×${sheet.height}px)` }),
      );
    });
    const hasPreviousValue = currentSheets.some((sheet) => sheet.id === previousValue);
    select.value = hasPreviousValue ? previousValue : UNASSIGNED_VALUE;
  }

  const dialog = h('dialog', { className: 'apply-all-dialog sheet-assign-dialog' }, [
    h('h2', { text: 'シートの割り当て' }),
    h('p', {
      className: 'field__hint',
      text: '保存されていたシートと同じ名前・サイズの画像が見つかりませんでした。現在読み込み済みのシートから選んで割り当てるか、「割り当てない」のままにしてください。',
    }),
    rowsContainer,
    h('div', { className: 'toolbar' }, [addMoreButton]),
    h('div', { className: 'csv-dialog__actions' }, [
      h('button', { className: 'button', attrs: { type: 'button' }, text: 'キャンセル', on: { click: () => dialog.close() } }),
      h('button', {
        className: 'button button--primary',
        attrs: { type: 'button' },
        text: '適用',
        on: {
          click: () => {
            const assignments: Record<string, string | null> = {};
            rowHandles.forEach((row) => {
              assignments[row.savedSheetId] = row.select.value === UNASSIGNED_VALUE ? null : row.select.value;
            });
            callbacks.onApply(assignments);
            dialog.close();
          },
        },
      }),
    ]),
  ]);
  document.body.append(dialog);

  function renderRows(rows: SheetAssignmentRow[], currentSheets: Sheet[]): void {
    rowsContainer.replaceChildren();
    rowHandles.length = 0;

    rows.forEach((row) => {
      const select = h('select', { className: 'sheet-assign-dialog__select' });
      buildOptions(select, currentSheets, row.suggestedSheetId);
      select.addEventListener('change', checkDuplicates);

      const duplicateHint = h('p', {
        className: 'sheet-assign-dialog__duplicate-hint',
        text: '⚠ 他の行と同じシートが選ばれています。',
      });
      duplicateHint.hidden = true;

      const sizeHint = row.sizeMismatch
        ? h('p', { className: 'sheet-assign-dialog__size-hint', text: '⚠ 候補はありますが、サイズが違います。' })
        : null;

      const children: Array<Node | string> = [
        h('span', {
          className: 'sheet-assign-dialog__label',
          text: `${row.savedSheet.name}(${row.savedSheet.width}×${row.savedSheet.height}px)`,
        }),
        select,
      ];
      if (sizeHint) {
        children.push(sizeHint);
      }
      children.push(duplicateHint);

      rowsContainer.append(h('div', { className: 'sheet-assign-dialog__row' }, children));
      rowHandles.push({ savedSheetId: row.savedSheet.id, select, duplicateHint });
    });

    checkDuplicates();
  }

  function open(rows: SheetAssignmentRow[], currentSheets: Sheet[]): void {
    renderRows(rows, currentSheets);
    dialog.showModal();
  }

  function refreshCandidates(rows: SheetAssignmentRow[], currentSheets: Sheet[]): void {
    // 行の構成(保存シートの集合)はそのまま、プルダウンの選択肢だけを更新する。
    const suggestionBySavedId = new Map(rows.map((row) => [row.savedSheet.id, row.suggestedSheetId]));
    rowHandles.forEach((row) => {
      buildOptions(row.select, currentSheets, suggestionBySavedId.get(row.savedSheetId));
    });
    checkDuplicates();
  }

  return { element: dialog, open, refreshCandidates };
}
