import { h } from '../shared/dom';
import type { ImageDataLike } from '../shared/types';
import type { Sheet } from './types';

export interface CompareOption {
  sheet: Sheet;
  /** そのシートを採用元にした場合の描画結果。生成に失敗した場合はnull。 */
  rendered: ImageDataLike | null;
}

export interface CompareDialogCallbacks {
  onSelect: (sheetId: string) => void;
}

export interface CompareDialogHandle {
  element: HTMLElement;
  open: (title: string, options: CompareOption[], selectedSheetId: string) => void;
}

function drawToCanvas(canvas: HTMLCanvasElement, image: ImageDataLike): void {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    );
  }
}

/** 「全シートで比較」ダイアログ。選択中の番号を、現在の調整値のまま全シートぶん並べて表示する。 */
export function createCompareDialog(callbacks: CompareDialogCallbacks): CompareDialogHandle {
  const titleEl = h('h2', {});
  const grid = h('div', { className: 'compare-dialog__grid' });
  const dialog = h('dialog', { className: 'compare-dialog' }, [
    titleEl,
    grid,
    h('div', { className: 'csv-dialog__actions' }, [
      h('button', {
        className: 'button',
        attrs: { type: 'button' },
        text: '閉じる',
        on: { click: () => dialog.close() },
      }),
    ]),
  ]);
  document.body.append(dialog);

  function open(title: string, options: CompareOption[], selectedSheetId: string): void {
    titleEl.textContent = title;
    grid.replaceChildren();

    options.forEach((option, i) => {
      const canvas = h('canvas', { className: 'compare-dialog__canvas' });
      if (option.rendered) {
        drawToCanvas(canvas, option.rendered);
      }
      const isSelected = option.sheet.id === selectedSheetId;
      const selectButton = h('button', {
        className: `button${isSelected ? ' button--active' : ''}`,
        attrs: { type: 'button' },
        text: isSelected ? '採用中' : 'これを採用',
        on: {
          click: () => {
            callbacks.onSelect(option.sheet.id);
            dialog.close();
          },
        },
      });
      grid.append(
        h('div', { className: 'compare-dialog__item' }, [
          h('p', { className: 'compare-dialog__name', text: `S${i + 1} ${option.sheet.name}` }),
          canvas,
          selectButton,
        ]),
      );
    });

    dialog.showModal();
  }

  return { element: dialog, open };
}
