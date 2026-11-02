import { h } from '../shared/dom';
import { imageDataLikeToPngBlob } from '../shared/imageData';
import { STAMP_MAX_FILE_SIZE_BYTES, stampFileName } from '../shared/lineSpec';
import type { ImageDataLike } from '../shared/types';

const SIZE_DEBOUNCE_MS = 300;

export interface StampCardHandle {
  element: HTMLElement;
  setImage: (image: ImageDataLike) => void;
  setSelected: (selected: boolean) => void;
  setCover: (isCover: boolean) => void;
  setAdjusted: (isAdjusted: boolean) => void;
  /** カードに出す警告の一覧(空なら警告アイコンを隠す)。ツールチップにそのまま使う。 */
  setWarnings: (labels: string[]) => void;
  /** 採用元シートのバッジ(例: 「S2」)。シートが1枚のときはnullを渡して隠す。 */
  setSourceBadge: (label: string | null) => void;
  getLastImage: () => ImageDataLike | null;
  getLastBlob: () => Blob | null;
}

/** ステップBの24枚プレビューの、1枚ぶんのカードUI。 */
export function createStampCard(
  index: number,
  onSelect: (index: number) => void,
  onSizeComputed?: (blob: Blob) => void,
): StampCardHandle {
  let lastImage: ImageDataLike | null = null;
  let lastBlob: Blob | null = null;
  let sizeTimer: number | undefined;

  const canvas = h('canvas', { className: 'stamp-card__canvas' });
  const coverBadge = h('span', {
    className: 'stamp-card__badge stamp-card__badge--cover',
    text: '表紙',
  });
  coverBadge.hidden = true;
  const adjustedDot = h('span', {
    className: 'stamp-card__dot',
    attrs: { 'aria-label': '個別設定あり', title: '個別設定あり' },
  });
  adjustedDot.hidden = true;
  const warningBadge = h('span', {
    className: 'stamp-card__badge stamp-card__badge--warning',
    text: '⚠',
  });
  warningBadge.hidden = true;
  const sourceBadge = h('span', { className: 'stamp-card__badge stamp-card__badge--source' });
  sourceBadge.hidden = true;

  const sizeLabel = h('span', { className: 'stamp-card__size', text: '-- KB' });
  const nameLabel = h('span', { className: 'stamp-card__name', text: stampFileName(index + 1) });

  const selectButton = h('button', {
    className: 'button button--text',
    attrs: { type: 'button' },
    text: '選択',
    on: { click: () => onSelect(index) },
  });

  const element = h('div', { className: 'stamp-card', attrs: { role: 'button', tabindex: '0' } }, [
    h('div', { className: 'stamp-card__canvas-wrapper' }, [
      canvas,
      coverBadge,
      sourceBadge,
      adjustedDot,
      warningBadge,
    ]),
    h('div', { className: 'stamp-card__footer' }, [nameLabel, sizeLabel]),
    selectButton,
  ]);

  element.addEventListener('click', (event) => {
    if (event.target === selectButton) {
      return;
    }
    onSelect(index);
  });
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(index);
    }
  });

  function scheduleSizeCalc(): void {
    if (sizeTimer !== undefined) {
      window.clearTimeout(sizeTimer);
    }
    sizeTimer = window.setTimeout(() => {
      const image = lastImage;
      if (!image) {
        return;
      }
      void imageDataLikeToPngBlob(image).then((blob) => {
        if (lastImage !== image) {
          return; // 計算中にさらに画像が更新されていたら、古い結果は捨てる
        }
        lastBlob = blob;
        const kb = Math.round(blob.size / 1024);
        sizeLabel.textContent = `${kb}KB`;
        sizeLabel.classList.toggle(
          'stamp-card__size--warning',
          blob.size > STAMP_MAX_FILE_SIZE_BYTES,
        );
        onSizeComputed?.(blob);
      });
    }, SIZE_DEBOUNCE_MS);
  }

  function setImage(image: ImageDataLike): void {
    lastImage = image;
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
    scheduleSizeCalc();
  }

  return {
    element,
    setImage,
    setSelected: (selected) => {
      element.classList.toggle('stamp-card--selected', selected);
      selectButton.textContent = selected ? '選択中' : '選択';
    },
    setCover: (isCover) => {
      coverBadge.hidden = !isCover;
    },
    setAdjusted: (isAdjusted) => {
      adjustedDot.hidden = !isAdjusted;
    },
    setWarnings: (labels) => {
      warningBadge.hidden = labels.length === 0;
      warningBadge.title = labels.join('、');
    },
    setSourceBadge: (label) => {
      sourceBadge.hidden = label === null;
      sourceBadge.textContent = label ?? '';
    },
    getLastImage: () => lastImage,
    getLastBlob: () => lastBlob,
  };
}
