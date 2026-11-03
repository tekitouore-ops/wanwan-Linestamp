import { h } from '../shared/dom';
import { imageDataLikeToCanvas } from '../shared/imageData';
import type { ImageDataLike } from '../shared/types';
import type { CellWarning, Rect, Sheet } from './types';

export interface SourceOption {
  sheet: Sheet;
  /** シートの画像が見つからない場合(未読込・読込中)はundefined。 */
  image: ImageDataLike | undefined;
  warnings: CellWarning[];
}

export interface SourcePickerCallbacks {
  onSelect: (sheetId: string) => void;
}

export interface SourcePickerHandle {
  element: HTMLElement;
  /** 選択中のスタンプ番号について、各シートの該当枠のサムネイルを並べる(ラジオボタン式)。 */
  setOptions: (index: number, options: SourceOption[], selectedSheetId: string) => void;
}

const THUMB_SIZE = 56;

function drawThumbnail(canvas: HTMLCanvasElement, image: ImageDataLike, frame: Rect): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (frame.width <= 0 || frame.height <= 0) {
    return;
  }
  const source = imageDataLikeToCanvas(image);
  const scale = Math.min(canvas.width / frame.width, canvas.height / frame.height);
  const drawWidth = frame.width * scale;
  const drawHeight = frame.height * scale;
  const dx = (canvas.width - drawWidth) / 2;
  const dy = (canvas.height - drawHeight) / 2;
  ctx.drawImage(source, frame.x, frame.y, frame.width, frame.height, dx, dy, drawWidth, drawHeight);
}

/**
 * ステップBの左パネル上部、「n番の採用元」セクション。シートが1枚以下のときは何も表示しない
 * (B-2仕様: 「シートが1枚だけのときは、採用元の選択UIは目立たなくする」)。
 */
export function createSourcePicker(callbacks: SourcePickerCallbacks): SourcePickerHandle {
  const list = h('div', { className: 'source-picker__list' });
  const element = h('div', { className: 'source-picker' }, [
    h('p', { className: 'field__label', text: '採用元' }),
    list,
  ]);
  element.hidden = true;

  function setOptions(index: number, options: SourceOption[], selectedSheetId: string): void {
    list.replaceChildren();
    if (options.length <= 1) {
      element.hidden = true;
      return;
    }
    element.hidden = false;

    options.forEach((option, i) => {
      const canvas = h('canvas', {
        className: 'source-picker__canvas',
        attrs: { width: String(THUMB_SIZE), height: String(THUMB_SIZE) },
      });
      const frame = option.sheet.frames[index];
      if (option.image && frame) {
        drawThumbnail(canvas, option.image, frame);
      }

      const isEmpty = option.warnings.includes('empty');
      const hasWarning = option.warnings.length > 0;
      const statusLabel = isEmpty ? '(空の枠)' : hasWarning ? '(警告あり)' : '';

      const badge = h('span', { className: 'source-picker__badge', text: `S${i + 1}` });
      const nameLabel = h('span', { className: 'source-picker__name', text: option.sheet.name });
      // 色だけに頼らず、文字でも空・警告の状態を示す(アイコン+短いラベル)。
      const statusText = h('span', {
        className: 'source-picker__status',
        text: isEmpty ? '⚠ 空' : hasWarning ? '⚠ 警告' : '',
      });
      statusText.hidden = !hasWarning;

      const button = h(
        'button',
        {
          className: [
            'source-picker__item',
            option.sheet.id === selectedSheetId ? 'source-picker__item--active' : '',
            hasWarning ? 'source-picker__item--warning' : '',
          ]
            .filter(Boolean)
            .join(' '),
          attrs: { type: 'button', title: `${option.sheet.name}${statusLabel}` },
          on: { click: () => callbacks.onSelect(option.sheet.id) },
        },
        [canvas, h('span', { className: 'source-picker__label' }, [badge, nameLabel]), statusText],
      );
      list.append(button);
    });
  }

  return { element, setOptions };
}
