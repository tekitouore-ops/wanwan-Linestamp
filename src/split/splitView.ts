import { isUpscaledTooMuch, renderStamp } from '../export/renderStamp';
import {
  DEFAULT_RENDER_SETTINGS,
  mergeRenderSettings,
  type CellOverride,
  type RenderSettings,
} from '../export/types';
import {
  validateDimensions,
  validateEmptyCells,
  validateFileSize,
  type ValidationIssue,
} from '../export/validate';
import { buildStampZipFromBlobs, formatZipFileName } from '../export/zip';
import { h } from '../shared/dom';
import { downloadBlob, downloadTextFile, openFilePicker } from '../shared/file';
import {
  downscaleImageData,
  imageDataLikeToCanvas,
  imageDataLikeToPngBlob,
  loadImageDataFromFile,
} from '../shared/imageData';
import {
  DEFAULT_GRID,
  DETECTION_MAX_DIMENSION_PX,
  STAMP_MAX_FILE_SIZE_BYTES,
  STAMP_MAX_HEIGHT,
  STAMP_MAX_WIDTH,
  stampFileName,
} from '../shared/lineSpec';
import { Store } from '../shared/store';
import type { ImageDataLike, RGB } from '../shared/types';
import { createDropzone } from '../ui/dropzone';
import { showToast } from '../ui/toast';
import {
  createEditorState,
  getCell,
  replaceBoxes,
  resetAllCells,
  resetCell,
  selectCell,
  swapCells,
  updateCellBox,
  type EditorCell,
  type EditorState,
} from './editorState';
import { detectGrid, detectGridEqualDivision, fitBoxToContent } from './gridSplit';
import { estimateBackgroundColor } from './mask';
import {
  DEFAULT_DETECTION_PARAMS,
  type BBox,
  type CellWarning,
  type DetectionMethod,
  type DetectionParams,
} from './types';

const VIEWPORT_WIDTH = 900;
const VIEWPORT_HEIGHT = 600;
const HANDLE_SCREEN_PX = 9;

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type DragMode =
  | { kind: 'move'; index: number; startImageX: number; startImageY: number; startBox: BBox }
  | { kind: 'resize'; index: number; handle: ResizeHandle; startBox: BBox }
  | { kind: 'draw'; index: number; startImageX: number; startImageY: number }
  | {
      kind: 'pan';
      startScreenX: number;
      startScreenY: number;
      startPanX: number;
      startPanY: number;
    };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pointInBox(point: { x: number; y: number }, box: BBox): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function clampBoxToImage(box: BBox, image: ImageDataLike): BBox {
  const width = clamp(box.width, 1, image.width);
  const height = clamp(box.height, 1, image.height);
  const x = clamp(box.x, 0, image.width - width);
  const y = clamp(box.y, 0, image.height - height);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function applyResize(box: BBox, handle: ResizeHandle, imageX: number, imageY: number): BBox {
  let x = box.x;
  let y = box.y;
  let right = box.x + box.width;
  let bottom = box.y + box.height;
  if (handle.includes('w')) {
    x = Math.min(imageX, right - 1);
  }
  if (handle.includes('e')) {
    right = Math.max(imageX, x + 1);
  }
  if (handle.includes('n')) {
    y = Math.min(imageY, bottom - 1);
  }
  if (handle.includes('s')) {
    bottom = Math.max(imageY, y + 1);
  }
  return { x, y, width: right - x, height: bottom - y };
}

function getHandlePoints(box: BBox): Record<ResizeHandle, { x: number; y: number }> {
  const { x, y, width, height } = box;
  return {
    nw: { x, y },
    n: { x: x + width / 2, y },
    ne: { x: x + width, y },
    w: { x, y: y + height / 2 },
    e: { x: x + width, y: y + height / 2 },
    sw: { x, y: y + height },
    s: { x: x + width / 2, y: y + height },
    se: { x: x + width, y: y + height },
  };
}

function hitTestHandle(
  box: BBox,
  imageX: number,
  imageY: number,
  tolerance: number,
): ResizeHandle | null {
  const points = getHandlePoints(box);
  let closest: ResizeHandle | null = null;
  let closestDist = tolerance;
  (Object.keys(points) as ResizeHandle[]).forEach((key) => {
    const point = points[key];
    const dist = Math.hypot(point.x - imageX, point.y - imageY);
    if (dist <= closestDist) {
      closestDist = dist;
      closest = key;
    }
  });
  return closest;
}

function dilateBox(box: BBox, marginRatio: number, image: ImageDataLike): BBox {
  const marginX = box.width * marginRatio;
  const marginY = box.height * marginRatio;
  const x = Math.max(0, box.x - marginX);
  const y = Math.max(0, box.y - marginY);
  const right = Math.min(image.width, box.x + box.width + marginX);
  const bottom = Math.min(image.height, box.y + box.height + marginY);
  return { x, y, width: right - x, height: bottom - y };
}

function getPixelColor(image: ImageDataLike, x: number, y: number): RGB {
  const px = clamp(Math.round(x), 0, image.width - 1);
  const py = clamp(Math.round(y), 0, image.height - 1);
  const i = (py * image.width + px) * 4;
  return { r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 };
}

function boxColor(cell: EditorCell, isSelected: boolean): string {
  if (isSelected) {
    return '#2d6cdf';
  }
  if (cell.warnings.includes('empty')) {
    return '#d9382b';
  }
  if (cell.warnings.length > 0) {
    return '#c98a00';
  }
  return '#2e7d32';
}

const WARNING_LABELS: Record<CellWarning, string> = {
  empty: '空(内容なし)',
  touchesBoundary: '境界に接触',
  sizeOutlier: 'サイズが他と大きく異なる',
};

function createSectionHeading(text: string): HTMLElement {
  return h('h3', { className: 'split-section-heading', text });
}

function createSliderField(
  labelText: string,
  options: { min: number; max: number; step: number; value: number },
): { element: HTMLElement; input: HTMLInputElement; valueLabel: HTMLElement } {
  const input = h('input', {
    attrs: {
      type: 'range',
      min: String(options.min),
      max: String(options.max),
      step: String(options.step),
    },
  });
  input.value = String(options.value);
  const valueLabel = h('span', { className: 'slider-field__value', text: String(options.value) });
  const element = h('div', { className: 'field slider-field' }, [
    h('label', { className: 'field__label' }, [labelText, ' ', valueLabel]),
    input,
  ]);
  return { element, input, valueLabel };
}

/** タブ②(画像分割・書き出し)のうち、Phase 3で実装する検出・エディタ部分の画面を構築する。 */
export function createSplitView(): HTMLElement {
  const editorStore = new Store<EditorState | null>(null);

  let originalImage: ImageDataLike | null = null;
  let cachedCanvas: HTMLCanvasElement | null = null;
  let baseScale = 1;
  let dragMode: DragMode | null = null;
  let eyedropperActive = false;
  let useEqualDivision = false;
  let lastMethod: DetectionMethod | null = null;
  let lastBackgroundColor: RGB = { r: 255, g: 255, b: 255 };
  const camera = { zoom: 1, panX: 0, panY: 0 };
  let detectionParams: DetectionParams = {
    ...DEFAULT_DETECTION_PARAMS,
    cols: DEFAULT_GRID.cols,
    rows: DEFAULT_GRID.rows,
  };

  let globalSettings: RenderSettings = { ...DEFAULT_RENDER_SETTINGS };
  const overrides: Partial<Record<number, CellOverride>> = {};
  const lastRenderedImages: Array<ImageDataLike | null> = new Array(
    DEFAULT_GRID.cols * DEFAULT_GRID.rows,
  ).fill(null);

  const emptyState = h('p', {
    className: 'placeholder',
    text: 'シート画像をアップロードすると、ここに自動検出された24個の枠が表示されます。',
  });

  const canvas = h('canvas', {
    className: 'split-canvas',
    attrs: { width: String(VIEWPORT_WIDTH), height: String(VIEWPORT_HEIGHT), tabindex: '0' },
  });

  const methodLabel = h('p', { className: 'split-method-label' });
  const warningList = h('ul', { className: 'warning-list' });
  const selectionPanel = h('div', { className: 'selection-panel' });

  const bgThreshold = createSliderField('背景判定しきい値', {
    min: 1,
    max: 80,
    step: 1,
    value: detectionParams.backgroundThreshold,
  });
  bgThreshold.input.addEventListener('input', () => {
    detectionParams = { ...detectionParams, backgroundThreshold: Number(bgThreshold.input.value) };
    bgThreshold.valueLabel.textContent = bgThreshold.input.value;
  });

  const minAreaPercent = (detectionParams.minAreaRatio * 100).toFixed(3);
  const minArea = createSliderField('ノイズ除去の最小面積(%)', {
    min: 0.001,
    max: 0.5,
    step: 0.001,
    value: Number(minAreaPercent),
  });
  minArea.input.addEventListener('input', () => {
    detectionParams = { ...detectionParams, minAreaRatio: Number(minArea.input.value) / 100 };
    minArea.valueLabel.textContent = minArea.input.value;
  });

  const equalDivisionCheckbox = h('input', { attrs: { type: 'checkbox' } });
  equalDivisionCheckbox.addEventListener('change', () => {
    useEqualDivision = equalDivisionCheckbox.checked;
  });
  const equalDivisionField = h('div', { className: 'field field--checkbox' }, [
    h('label', { className: 'checkbox-field' }, [
      equalDivisionCheckbox,
      ' 自動検出の代わりに均等分割を使う',
    ]),
  ]);

  const eyedropperButton = h('button', {
    className: 'button',
    attrs: { type: 'button', 'aria-pressed': 'false' },
    text: 'スポイトで背景色を指定',
    on: {
      click: () => {
        eyedropperActive = !eyedropperActive;
        eyedropperButton.setAttribute('aria-pressed', String(eyedropperActive));
        eyedropperButton.classList.toggle('button--active', eyedropperActive);
        canvas.style.cursor = eyedropperActive ? 'crosshair' : '';
      },
    },
  });

  const redetectButton = h('button', {
    className: 'button button--primary',
    attrs: { type: 'button' },
    text: '再検出',
    on: { click: () => runDetection() },
  });

  const resetAllButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '枠の編集内容をリセット',
    on: {
      click: () => {
        editorStore.setState((s) => (s ? resetAllCells(s) : s));
        showToast('直近の検出結果に戻しました。');
      },
    },
  });

  const zoomOutButton = h('button', {
    className: 'button',
    attrs: { type: 'button', 'aria-label': '縮小' },
    text: '−',
    on: { click: () => setZoom(camera.zoom / 1.25) },
  });
  const zoomInButton = h('button', {
    className: 'button',
    attrs: { type: 'button', 'aria-label': '拡大' },
    text: '＋',
    on: { click: () => setZoom(camera.zoom * 1.25) },
  });
  const zoomResetButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '表示をリセット',
    on: {
      click: () => {
        camera.zoom = 1;
        camera.panX = 0;
        camera.panY = 0;
        render();
      },
    },
  });

  const numberSelect = h('select', {});
  for (let i = 1; i <= DEFAULT_GRID.cols * DEFAULT_GRID.rows; i += 1) {
    numberSelect.append(h('option', { attrs: { value: String(i) }, text: `No.${i}` }));
  }
  const swapButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '選択中の枠と入れ替え',
    on: {
      click: () => {
        const editor = editorStore.getState();
        if (!editor || editor.selectedIndex === null) {
          showToast('先に入れ替えたい枠を選択してください。', 'error');
          return;
        }
        const targetIndex = Number(numberSelect.value) - 1;
        editorStore.setState((s) =>
          s ? swapCells(s, editor.selectedIndex as number, targetIndex) : s,
        );
      },
    },
  });

  const fitButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '内容にフィット',
    on: {
      click: () => {
        const editor = editorStore.getState();
        if (!editor || editor.selectedIndex === null || !originalImage) {
          showToast('先に枠を選択してください。', 'error');
          return;
        }
        const cell = getCell(editor, editor.selectedIndex);
        if (!cell) {
          return;
        }
        const region = dilateBox(cell.box, 0.3, originalImage);
        const fitted = fitBoxToContent(originalImage, region, detectionParams);
        editorStore.setState((s) => (s ? updateCellBox(s, cell.index, fitted) : s));
      },
    },
  });

  const resetSelectedButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: 'この枠だけリセット',
    on: {
      click: () => {
        const editor = editorStore.getState();
        if (!editor || editor.selectedIndex === null) {
          return;
        }
        editorStore.setState((s) => (s ? resetCell(s, editor.selectedIndex as number) : s));
      },
    },
  });

  // ---- プレビュー・書き出し(Phase 4) ----

  let renderAllTimer: number | undefined;
  function scheduleRenderAll(): void {
    if (renderAllTimer !== undefined) {
      window.clearTimeout(renderAllTimer);
    }
    renderAllTimer = window.setTimeout(() => renderAllThumbnails(), 250);
  }

  function renderThumbnail(index: number): void {
    const thumb = thumbnails[index];
    const editor = editorStore.getState();
    if (!thumb || !originalImage || !editor) {
      return;
    }
    const cell = getCell(editor, index);
    if (!cell) {
      return;
    }
    const settings = mergeRenderSettings(globalSettings, overrides[index]);
    const rendered = renderStamp(originalImage, cell.box, lastBackgroundColor, settings);
    lastRenderedImages[index] = rendered;

    thumb.canvas.width = rendered.width;
    thumb.canvas.height = rendered.height;
    const ctx = thumb.canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(rendered.data), rendered.width, rendered.height),
        0,
        0,
      );
    }
    thumb.badge.hidden = !isUpscaledTooMuch(cell.box, settings);
    thumb.overrideMark.hidden = !overrides[index];
  }

  function renderAllThumbnails(): void {
    if (!originalImage) {
      return;
    }
    for (let i = 0; i < thumbnails.length; i += 1) {
      renderThumbnail(i);
    }
  }

  interface ThumbnailRefs {
    canvas: HTMLCanvasElement;
    badge: HTMLElement;
    overrideMark: HTMLElement;
  }

  const thumbnails: ThumbnailRefs[] = [];
  const previewGrid = h('div', { className: 'preview-grid preview-grid--checker' });

  for (let i = 0; i < DEFAULT_GRID.cols * DEFAULT_GRID.rows; i += 1) {
    const index = i;
    const thumbCanvas = h('canvas', { className: 'preview-thumb__canvas' });
    const badge = h('span', { className: 'preview-thumb__badge', text: '解像度不足' });
    badge.hidden = true;
    const overrideMark = h('span', { className: 'preview-thumb__override-mark', text: '個別設定' });
    overrideMark.hidden = true;

    const downloadButton = h('button', {
      className: 'button button--text',
      attrs: { type: 'button' },
      text: 'PNG保存',
      on: {
        click: () => {
          const image = lastRenderedImages[index];
          if (!image) {
            showToast('先にプレビューを表示してください。', 'error');
            return;
          }
          void imageDataLikeToPngBlob(image).then((blob) =>
            downloadBlob(blob, stampFileName(index + 1)),
          );
        },
      },
    });

    const container = h(
      'div',
      { className: 'preview-thumb', attrs: { role: 'button', tabindex: '0' } },
      [
        h('div', { className: 'preview-thumb__canvas-wrapper' }, [
          thumbCanvas,
          badge,
          overrideMark,
        ]),
        h('div', { className: 'preview-thumb__footer' }, [
          h('span', { text: `No.${index + 1}` }),
          downloadButton,
        ]),
      ],
    );
    container.addEventListener('click', (event) => {
      if (event.target === downloadButton) {
        return;
      }
      editorStore.setState((s) => (s ? selectCell(s, index) : s));
    });

    thumbnails.push({ canvas: thumbCanvas, badge, overrideMark });
    previewGrid.append(container);
  }

  function setPreviewBackground(bg: 'checker' | 'white' | 'dark' | 'chat'): void {
    previewGrid.className = `preview-grid preview-grid--${bg}`;
    [bgCheckerButton, bgWhiteButton, bgDarkButton, bgChatButton].forEach((btn) => {
      btn.classList.remove('button--active');
    });
    const activeButton = {
      checker: bgCheckerButton,
      white: bgWhiteButton,
      dark: bgDarkButton,
      chat: bgChatButton,
    }[bg];
    activeButton.classList.add('button--active');
  }

  const bgCheckerButton = h('button', {
    className: 'button button--active',
    attrs: { type: 'button' },
    text: '市松(透過確認)',
    on: { click: () => setPreviewBackground('checker') },
  });
  const bgWhiteButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '白背景',
    on: { click: () => setPreviewBackground('white') },
  });
  const bgDarkButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: 'ダーク背景',
    on: { click: () => setPreviewBackground('dark') },
  });
  const bgChatButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: 'チャット風背景',
    on: { click: () => setPreviewBackground('chat') },
  });

  function createGlobalSlider(
    label: string,
    options: { min: number; max: number; step: number; value: number },
    onChange: (value: number) => void,
  ): { element: HTMLElement; input: HTMLInputElement; valueLabel: HTMLElement } {
    const slider = createSliderField(label, options);
    slider.input.addEventListener('input', () => {
      const value = Number(slider.input.value);
      slider.valueLabel.textContent = slider.input.value;
      onChange(value);
      scheduleRenderAll();
    });
    return slider;
  }

  const outputWidthSlider = createGlobalSlider(
    '出力幅(px)',
    { min: 100, max: STAMP_MAX_WIDTH, step: 2, value: globalSettings.outputWidth },
    (v) => {
      globalSettings = { ...globalSettings, outputWidth: v };
    },
  );
  const outputHeightSlider = createGlobalSlider(
    '出力高さ(px)',
    { min: 100, max: STAMP_MAX_HEIGHT, step: 2, value: globalSettings.outputHeight },
    (v) => {
      globalSettings = { ...globalSettings, outputHeight: v };
    },
  );
  const marginTopSlider = createGlobalSlider(
    '余白(上)',
    { min: 0, max: 50, step: 1, value: globalSettings.marginTop },
    (v) => {
      globalSettings = { ...globalSettings, marginTop: v };
    },
  );
  const marginRightSlider = createGlobalSlider(
    '余白(右)',
    { min: 0, max: 50, step: 1, value: globalSettings.marginRight },
    (v) => {
      globalSettings = { ...globalSettings, marginRight: v };
    },
  );
  const marginBottomSlider = createGlobalSlider(
    '余白(下)',
    { min: 0, max: 50, step: 1, value: globalSettings.marginBottom },
    (v) => {
      globalSettings = { ...globalSettings, marginBottom: v };
    },
  );
  const marginLeftSlider = createGlobalSlider(
    '余白(左)',
    { min: 0, max: 50, step: 1, value: globalSettings.marginLeft },
    (v) => {
      globalSettings = { ...globalSettings, marginLeft: v };
    },
  );
  const scaleSlider = createGlobalSlider(
    '拡大率',
    { min: 0.5, max: 1.5, step: 0.05, value: globalSettings.scale },
    (v) => {
      globalSettings = { ...globalSettings, scale: v };
    },
  );
  const offsetXSlider = createGlobalSlider(
    'オフセットX(px)',
    { min: -100, max: 100, step: 1, value: globalSettings.offsetX },
    (v) => {
      globalSettings = { ...globalSettings, offsetX: v };
    },
  );
  const offsetYSlider = createGlobalSlider(
    'オフセットY(px)',
    { min: -100, max: 100, step: 1, value: globalSettings.offsetY },
    (v) => {
      globalSettings = { ...globalSettings, offsetY: v };
    },
  );
  const alphaThresholdSlider = createGlobalSlider(
    '透過しきい値',
    { min: 1, max: 80, step: 1, value: globalSettings.alphaThreshold },
    (v) => {
      globalSettings = { ...globalSettings, alphaThreshold: v };
    },
  );
  const featherSlider = createGlobalSlider(
    'エッジのぼかし(px)',
    { min: 0, max: 3, step: 1, value: globalSettings.featherPx },
    (v) => {
      globalSettings = { ...globalSettings, featherPx: v };
    },
  );
  const outlineWidthSlider = createGlobalSlider(
    '白フチ幅(px)',
    { min: 0, max: 16, step: 1, value: globalSettings.outlineWidthPx },
    (v) => {
      globalSettings = { ...globalSettings, outlineWidthPx: v };
    },
  );

  const alignSelect = h('select', {});
  alignSelect.append(
    h('option', { attrs: { value: 'center' }, text: '中央' }),
    h('option', { attrs: { value: 'bottom' }, text: '下揃え' }),
  );
  alignSelect.value = globalSettings.align;
  alignSelect.addEventListener('change', () => {
    globalSettings = {
      ...globalSettings,
      align: alignSelect.value === 'bottom' ? 'bottom' : 'center',
    };
    scheduleRenderAll();
  });
  const alignField = h('div', { className: 'field' }, [
    h('label', { className: 'field__label', text: '揃え' }),
    alignSelect,
  ]);

  const allowUpscaleCheckbox = h('input', { attrs: { type: 'checkbox' } });
  allowUpscaleCheckbox.checked = globalSettings.allowUpscale;
  allowUpscaleCheckbox.addEventListener('change', () => {
    globalSettings = { ...globalSettings, allowUpscale: allowUpscaleCheckbox.checked };
    scheduleRenderAll();
  });
  const allowUpscaleField = h('div', { className: 'field field--checkbox' }, [
    h('label', { className: 'checkbox-field' }, [
      allowUpscaleCheckbox,
      ' 被写体が小さいときの拡大を許可する',
    ]),
  ]);

  // ---- 書き出し(検証・ZIP) ----

  const exportIssueList = h('ul', { className: 'warning-list' });

  function renderExportIssues(issues: ValidationIssue[]): void {
    exportIssueList.replaceChildren();
    if (issues.length === 0) {
      exportIssueList.append(
        h('li', { className: 'warning-list__empty', text: '問題は見つかりませんでした。' }),
      );
      return;
    }
    issues.forEach((issue) => {
      exportIssueList.append(h('li', { text: issue.message }));
    });
  }

  const exportButton = h('button', {
    className: 'button button--primary',
    attrs: { type: 'button' },
    text: 'ZIPで書き出し',
    on: { click: () => void handleExport() },
  });

  async function handleExport(): Promise<void> {
    if (!originalImage) {
      showToast('先にシート画像を読み込んでください。', 'error');
      return;
    }
    const editor = editorStore.getState();
    if (!editor) {
      return;
    }

    exportButton.setAttribute('disabled', 'true');
    try {
      const emptyIndexes = editor.cells
        .filter((cell) => cell.warnings.includes('empty'))
        .map((cell) => cell.index);
      const images: ImageDataLike[] = [];
      const dimensionIssues: ValidationIssue[] = [];

      editor.cells.forEach((cell) => {
        const settings = mergeRenderSettings(globalSettings, overrides[cell.index]);
        const rendered = renderStamp(
          originalImage as ImageDataLike,
          cell.box,
          lastBackgroundColor,
          settings,
        );
        images[cell.index] = rendered;
        dimensionIssues.push(
          ...validateDimensions(
            cell.index,
            rendered.width,
            rendered.height,
            STAMP_MAX_WIDTH,
            STAMP_MAX_HEIGHT,
          ),
        );
      });

      const blobs: Blob[] = [];
      for (const image of images) {
        blobs.push(await imageDataLikeToPngBlob(image));
      }
      const sizeIssues = blobs.flatMap((blob, index) =>
        validateFileSize(index, blob.size, STAMP_MAX_FILE_SIZE_BYTES),
      );

      const allIssues = [...validateEmptyCells(emptyIndexes), ...dimensionIssues, ...sizeIssues];
      renderExportIssues(allIssues);

      if (allIssues.length > 0) {
        const preview = allIssues
          .slice(0, 5)
          .map((issue) => issue.message)
          .join('\n');
        const more = allIssues.length > 5 ? `\n...ほか${allIssues.length - 5}件` : '';
        const proceed = window.confirm(
          `${allIssues.length}件の警告があります。このまま書き出しますか?\n\n${preview}${more}`,
        );
        if (!proceed) {
          showToast('書き出しを中止しました。', 'error');
          return;
        }
      }

      const zipBlob = await buildStampZipFromBlobs(blobs);
      downloadBlob(zipBlob, formatZipFileName(new Date()));
      showToast('ZIPを書き出しました。');
    } catch {
      showToast('書き出しに失敗しました。もう一度お試しください。', 'error');
    } finally {
      exportButton.removeAttribute('disabled');
    }
  }

  // ---- 検出枠・設定のJSON保存/読込 ----

  function formatSettingsTimestamp(date: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  function syncSlider(
    slider: { input: HTMLInputElement; valueLabel: HTMLElement },
    value: number,
  ): void {
    slider.input.value = String(value);
    slider.valueLabel.textContent = String(value);
  }

  function refreshGlobalSettingsControls(): void {
    syncSlider(outputWidthSlider, globalSettings.outputWidth);
    syncSlider(outputHeightSlider, globalSettings.outputHeight);
    syncSlider(marginTopSlider, globalSettings.marginTop);
    syncSlider(marginRightSlider, globalSettings.marginRight);
    syncSlider(marginBottomSlider, globalSettings.marginBottom);
    syncSlider(marginLeftSlider, globalSettings.marginLeft);
    syncSlider(scaleSlider, globalSettings.scale);
    syncSlider(offsetXSlider, globalSettings.offsetX);
    syncSlider(offsetYSlider, globalSettings.offsetY);
    syncSlider(alphaThresholdSlider, globalSettings.alphaThreshold);
    syncSlider(featherSlider, globalSettings.featherPx);
    syncSlider(outlineWidthSlider, globalSettings.outlineWidthPx);
    alignSelect.value = globalSettings.align;
    allowUpscaleCheckbox.checked = globalSettings.allowUpscale;
  }

  const saveSettingsButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '検出枠・設定をJSONで保存',
    on: {
      click: () => {
        const editor = editorStore.getState();
        if (!editor) {
          showToast('先にシート画像を読み込んでください。', 'error');
          return;
        }
        const payload = {
          version: 1,
          cells: editor.cells.map((cell) => ({ index: cell.index, box: cell.box })),
          globalSettings,
          overrides,
        };
        downloadTextFile(
          `wanwan-linestamp-split-settings_${formatSettingsTimestamp(new Date())}.json`,
          JSON.stringify(payload, null, 2),
          'application/json',
        );
      },
    },
  });

  const loadSettingsButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '検出枠・設定をJSONで読み込み',
    on: {
      click: () => {
        void openFilePicker('application/json').then(async (file) => {
          if (!file) {
            return;
          }
          try {
            const text = await file.text();
            const parsed: unknown = JSON.parse(text);
            if (!isRecord(parsed) || !Array.isArray(parsed.cells)) {
              showToast('設定ファイルの形式が正しくありません。', 'error');
              return;
            }

            const boxes: Partial<Record<number, BBox>> = {};
            for (const entry of parsed.cells) {
              if (!isRecord(entry) || typeof entry.index !== 'number' || !isRecord(entry.box)) {
                continue;
              }
              const b = entry.box;
              if (
                typeof b.x === 'number' &&
                typeof b.y === 'number' &&
                typeof b.width === 'number' &&
                typeof b.height === 'number'
              ) {
                boxes[entry.index] = { x: b.x, y: b.y, width: b.width, height: b.height };
              }
            }
            editorStore.setState((s) => (s ? replaceBoxes(s, boxes) : s));

            if (isRecord(parsed.globalSettings)) {
              globalSettings = {
                ...globalSettings,
                ...(parsed.globalSettings as Partial<RenderSettings>),
              };
              refreshGlobalSettingsControls();
            }
            if (isRecord(parsed.overrides)) {
              Object.keys(overrides).forEach((key) => {
                delete overrides[Number(key)];
              });
              Object.entries(parsed.overrides).forEach(([key, value]) => {
                if (isRecord(value)) {
                  overrides[Number(key)] = value as CellOverride;
                }
              });
            }

            scheduleRenderAll();
            showToast('検出枠・設定を読み込みました。');
          } catch {
            showToast('設定ファイルの読み込みに失敗しました。', 'error');
          }
        });
      },
    },
  });

  function setZoom(newZoom: number): void {
    camera.zoom = clamp(newZoom, 0.25, 4);
    render();
  }

  function getScale(): number {
    return baseScale * camera.zoom;
  }

  function screenToImage(screenX: number, screenY: number): { x: number; y: number } {
    const scale = getScale();
    return { x: camera.panX + screenX / scale, y: camera.panY + screenY / scale };
  }

  function runDetection(): void {
    if (!originalImage) {
      return;
    }
    const detectionSource = downscaleImageData(originalImage, DETECTION_MAX_DIMENSION_PX);
    const scaleToOriginal = originalImage.width / detectionSource.width;
    lastBackgroundColor =
      detectionParams.backgroundColor ?? estimateBackgroundColor(detectionSource);

    const result = useEqualDivision
      ? detectGridEqualDivision(detectionSource, detectionParams)
      : detectGrid(detectionSource, detectionParams);

    const scaledCells = result.cells.map((cell) => ({
      ...cell,
      box: {
        x: Math.round(cell.box.x * scaleToOriginal),
        y: Math.round(cell.box.y * scaleToOriginal),
        width: Math.round(cell.box.width * scaleToOriginal),
        height: Math.round(cell.box.height * scaleToOriginal),
      },
    }));

    lastMethod = result.method;
    editorStore.setState(createEditorState({ cells: scaledCells, method: result.method }));
  }

  function updateMethodLabel(): void {
    if (!lastMethod) {
      methodLabel.textContent = '';
      return;
    }
    if (lastMethod === 'projection') {
      methodLabel.textContent = '検出方式: 自動検出(投影法)';
    } else if (useEqualDivision) {
      methodLabel.textContent = '検出方式: 均等分割(手動選択)';
    } else {
      methodLabel.textContent = '検出方式: 均等分割(自動検出に失敗したためフォールバック)';
    }
  }

  function updateWarningList(editor: EditorState): void {
    warningList.replaceChildren();
    const withWarnings = editor.cells.filter((cell) => cell.warnings.length > 0);
    if (withWarnings.length === 0) {
      warningList.append(h('li', { className: 'warning-list__empty', text: '警告はありません。' }));
      return;
    }
    withWarnings.forEach((cell) => {
      const labels = cell.warnings.map((w) => WARNING_LABELS[w]).join('、');
      warningList.append(h('li', { text: `No.${cell.index + 1}: ${labels}` }));
    });
  }

  // ---- 個別設定(拡大率・オフセット・余白・白フチ幅の上書き) ----

  let overridePanelIndex: number | null = null;

  const overrideToggle = h('input', { attrs: { type: 'checkbox' } });
  const overrideToggleField = h('div', { className: 'field field--checkbox' }, [
    h('label', { className: 'checkbox-field' }, [
      overrideToggle,
      ' このスタンプだけ個別設定を使う',
    ]),
  ]);

  const overrideScaleSlider = createSliderField('拡大率(個別)', {
    min: 0.5,
    max: 1.5,
    step: 0.05,
    value: 1,
  });
  const overrideOffsetXSlider = createSliderField('オフセットX(個別・px)', {
    min: -100,
    max: 100,
    step: 1,
    value: 0,
  });
  const overrideOffsetYSlider = createSliderField('オフセットY(個別・px)', {
    min: -100,
    max: 100,
    step: 1,
    value: 0,
  });
  const overrideMarginSlider = createSliderField('余白(個別・上下左右共通・px)', {
    min: 0,
    max: 50,
    step: 1,
    value: 10,
  });
  const overrideOutlineSlider = createSliderField('白フチ幅(個別・px)', {
    min: 0,
    max: 16,
    step: 1,
    value: 6,
  });

  const overrideSlidersWrapper = h('div', { className: 'override-sliders' }, [
    overrideScaleSlider.element,
    overrideOffsetXSlider.element,
    overrideOffsetYSlider.element,
    overrideMarginSlider.element,
    overrideOutlineSlider.element,
  ]);
  overrideSlidersWrapper.hidden = true;

  function updateOverrideField(index: number, patch: Partial<CellOverride>): void {
    const current = overrides[index] ?? {};
    overrides[index] = { ...current, ...patch };
    scheduleRenderAll();
  }

  function syncOverrideSlidersFromState(index: number): void {
    const o = overrides[index];
    if (!o) {
      return;
    }
    syncSlider(overrideScaleSlider, o.scale ?? globalSettings.scale);
    syncSlider(overrideOffsetXSlider, o.offsetX ?? globalSettings.offsetX);
    syncSlider(overrideOffsetYSlider, o.offsetY ?? globalSettings.offsetY);
    syncSlider(overrideMarginSlider, o.marginTop ?? globalSettings.marginTop);
    syncSlider(overrideOutlineSlider, o.outlineWidthPx ?? globalSettings.outlineWidthPx);
  }

  overrideToggle.addEventListener('change', () => {
    if (overridePanelIndex === null) {
      return;
    }
    if (overrideToggle.checked) {
      overrides[overridePanelIndex] = {
        scale: globalSettings.scale,
        offsetX: globalSettings.offsetX,
        offsetY: globalSettings.offsetY,
        marginTop: globalSettings.marginTop,
        marginRight: globalSettings.marginRight,
        marginBottom: globalSettings.marginBottom,
        marginLeft: globalSettings.marginLeft,
        outlineWidthPx: globalSettings.outlineWidthPx,
      };
      syncOverrideSlidersFromState(overridePanelIndex);
      overrideSlidersWrapper.hidden = false;
    } else {
      delete overrides[overridePanelIndex];
      overrideSlidersWrapper.hidden = true;
    }
    scheduleRenderAll();
  });

  overrideScaleSlider.input.addEventListener('input', () => {
    if (overridePanelIndex === null) {
      return;
    }
    overrideScaleSlider.valueLabel.textContent = overrideScaleSlider.input.value;
    updateOverrideField(overridePanelIndex, { scale: Number(overrideScaleSlider.input.value) });
  });
  overrideOffsetXSlider.input.addEventListener('input', () => {
    if (overridePanelIndex === null) {
      return;
    }
    overrideOffsetXSlider.valueLabel.textContent = overrideOffsetXSlider.input.value;
    updateOverrideField(overridePanelIndex, { offsetX: Number(overrideOffsetXSlider.input.value) });
  });
  overrideOffsetYSlider.input.addEventListener('input', () => {
    if (overridePanelIndex === null) {
      return;
    }
    overrideOffsetYSlider.valueLabel.textContent = overrideOffsetYSlider.input.value;
    updateOverrideField(overridePanelIndex, { offsetY: Number(overrideOffsetYSlider.input.value) });
  });
  overrideMarginSlider.input.addEventListener('input', () => {
    if (overridePanelIndex === null) {
      return;
    }
    const v = Number(overrideMarginSlider.input.value);
    overrideMarginSlider.valueLabel.textContent = overrideMarginSlider.input.value;
    updateOverrideField(overridePanelIndex, {
      marginTop: v,
      marginRight: v,
      marginBottom: v,
      marginLeft: v,
    });
  });
  overrideOutlineSlider.input.addEventListener('input', () => {
    if (overridePanelIndex === null) {
      return;
    }
    overrideOutlineSlider.valueLabel.textContent = overrideOutlineSlider.input.value;
    updateOverrideField(overridePanelIndex, {
      outlineWidthPx: Number(overrideOutlineSlider.input.value),
    });
  });

  const overridePanel = h('div', { className: 'override-panel' }, [
    overrideToggleField,
    overrideSlidersWrapper,
  ]);

  function updateSelectionPanel(editor: EditorState): void {
    selectionPanel.replaceChildren();
    if (editor.selectedIndex === null) {
      overridePanelIndex = null;
      selectionPanel.append(
        h('p', { className: 'field__hint', text: '枠をクリックすると選択できます。' }),
      );
      return;
    }
    const cell = getCell(editor, editor.selectedIndex);
    if (!cell) {
      return;
    }

    overridePanelIndex = cell.index;
    const hasOverride = Boolean(overrides[cell.index]);
    overrideToggle.checked = hasOverride;
    overrideSlidersWrapper.hidden = !hasOverride;
    if (hasOverride) {
      syncOverrideSlidersFromState(cell.index);
    }

    selectionPanel.append(
      h('p', {
        text: `選択中: No.${cell.index + 1}${cell.isManuallyEdited ? '(手動編集済み)' : ''}`,
      }),
      h('div', { className: 'toolbar' }, [fitButton, resetSelectedButton]),
      h('div', { className: 'toolbar' }, [numberSelect, swapButton]),
      overridePanel,
    );
  }

  function render(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx || !originalImage || !cachedCanvas) {
      return;
    }
    const editor = editorStore.getState();
    if (!editor) {
      return;
    }

    const scale = getScale();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-camera.panX, -camera.panY);
    ctx.drawImage(cachedCanvas, 0, 0);

    editor.cells.forEach((cell) => {
      const isSelected = cell.index === editor.selectedIndex;
      ctx.lineWidth = (isSelected ? 3 : 2) / scale;
      ctx.strokeStyle = boxColor(cell, isSelected);
      ctx.strokeRect(cell.box.x, cell.box.y, cell.box.width, cell.box.height);
    });
    ctx.restore();

    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'top';
    editor.cells.forEach((cell) => {
      const isSelected = cell.index === editor.selectedIndex;
      const screenX = (cell.box.x - camera.panX) * scale;
      const screenY = (cell.box.y - camera.panY) * scale;
      ctx.fillStyle = boxColor(cell, isSelected);
      ctx.fillRect(screenX, screenY, 20, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(cell.index + 1), screenX + 4, screenY + 2);
    });

    updateMethodLabel();
    updateWarningList(editor);
    updateSelectionPanel(editor);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!originalImage) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const imagePoint = screenToImage(screenX, screenY);

    if (eyedropperActive) {
      const color = getPixelColor(originalImage, imagePoint.x, imagePoint.y);
      detectionParams = { ...detectionParams, backgroundColor: color };
      eyedropperActive = false;
      eyedropperButton.setAttribute('aria-pressed', 'false');
      eyedropperButton.classList.remove('button--active');
      canvas.style.cursor = '';
      runDetection();
      showToast('背景色を指定しました。再検出しました。');
      return;
    }

    const editor = editorStore.getState();
    if (!editor) {
      return;
    }

    const scale = getScale();
    const handleTolerance = HANDLE_SCREEN_PX / scale;
    const selected =
      editor.selectedIndex !== null ? getCell(editor, editor.selectedIndex) : undefined;

    if (selected) {
      const handle = hitTestHandle(selected.box, imagePoint.x, imagePoint.y, handleTolerance);
      if (handle) {
        dragMode = { kind: 'resize', index: selected.index, handle, startBox: selected.box };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
    }

    const hitCell = [...editor.cells].reverse().find((cell) => pointInBox(imagePoint, cell.box));
    if (hitCell) {
      editorStore.setState((s) => (s ? selectCell(s, hitCell.index) : s));
      dragMode = {
        kind: 'move',
        index: hitCell.index,
        startImageX: imagePoint.x,
        startImageY: imagePoint.y,
        startBox: hitCell.box,
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.focus();
      return;
    }

    if (editor.selectedIndex !== null) {
      dragMode = {
        kind: 'draw',
        index: editor.selectedIndex,
        startImageX: imagePoint.x,
        startImageY: imagePoint.y,
      };
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    dragMode = {
      kind: 'pan',
      startScreenX: screenX,
      startScreenY: screenY,
      startPanX: camera.panX,
      startPanY: camera.panY,
    };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragMode || !originalImage) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    if (dragMode.kind === 'pan') {
      const scale = getScale();
      camera.panX = dragMode.startPanX - (screenX - dragMode.startScreenX) / scale;
      camera.panY = dragMode.startPanY - (screenY - dragMode.startScreenY) / scale;
      render();
      return;
    }

    const imagePoint = screenToImage(screenX, screenY);

    if (dragMode.kind === 'move') {
      const dx = imagePoint.x - dragMode.startImageX;
      const dy = imagePoint.y - dragMode.startImageY;
      const box = clampBoxToImage(
        { ...dragMode.startBox, x: dragMode.startBox.x + dx, y: dragMode.startBox.y + dy },
        originalImage,
      );
      const targetIndex = dragMode.index;
      editorStore.setState((s) => (s ? updateCellBox(s, targetIndex, box) : s));
    } else if (dragMode.kind === 'resize') {
      const box = clampBoxToImage(
        applyResize(dragMode.startBox, dragMode.handle, imagePoint.x, imagePoint.y),
        originalImage,
      );
      const targetIndex = dragMode.index;
      editorStore.setState((s) => (s ? updateCellBox(s, targetIndex, box) : s));
    } else if (dragMode.kind === 'draw') {
      const x = Math.min(dragMode.startImageX, imagePoint.x);
      const y = Math.min(dragMode.startImageY, imagePoint.y);
      const width = Math.max(1, Math.abs(imagePoint.x - dragMode.startImageX));
      const height = Math.max(1, Math.abs(imagePoint.y - dragMode.startImageY));
      const box = clampBoxToImage({ x, y, width, height }, originalImage);
      const targetIndex = dragMode.index;
      editorStore.setState((s) => (s ? updateCellBox(s, targetIndex, box) : s));
    }
  });

  canvas.addEventListener('pointerup', (event) => {
    dragMode = null;
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => {
    dragMode = null;
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!originalImage) {
        return;
      }
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const before = screenToImage(screenX, screenY);
      const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
      camera.zoom = clamp(camera.zoom * zoomFactor, 0.25, 4);
      const scale = getScale();
      camera.panX = before.x - screenX / scale;
      camera.panY = before.y - screenY / scale;
      render();
    },
    { passive: false },
  );

  canvas.addEventListener('keydown', (event) => {
    const editor = editorStore.getState();
    if (!editor || editor.selectedIndex === null || !originalImage) {
      return;
    }
    const cell = getCell(editor, editor.selectedIndex);
    if (!cell) {
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    let { x, y } = cell.box;
    if (event.key === 'ArrowLeft') {
      x -= step;
    } else if (event.key === 'ArrowRight') {
      x += step;
    } else if (event.key === 'ArrowUp') {
      y -= step;
    } else if (event.key === 'ArrowDown') {
      y += step;
    } else {
      return;
    }
    event.preventDefault();
    const box = clampBoxToImage({ ...cell.box, x, y }, originalImage);
    editorStore.setState((s) => (s ? updateCellBox(s, cell.index, box) : s));
  });

  editorStore.subscribe(() => render());

  const dropzone = createDropzone({
    label: 'シート画像をドラッグ&ドロップ、またはクリックして選択',
    hint: 'PNG/JPEG/WebP。6列×4行(24個)のスタンプが並んだシート画像を選んでください。',
    onFile: (file) => {
      void loadImageDataFromFile(file)
        .then((image) => {
          originalImage = image;
          cachedCanvas = imageDataLikeToCanvas(image);
          baseScale =
            Math.min(VIEWPORT_WIDTH / image.width, VIEWPORT_HEIGHT / image.height, 1) || 1;
          camera.zoom = 1;
          camera.panX = 0;
          camera.panY = 0;
          emptyState.hidden = true;
          workspace.hidden = false;
          exportSection.hidden = false;
          runDetection();
          renderAllThumbnails();
        })
        .catch(() => {
          showToast('画像の読み込みに失敗しました。別のファイルをお試しください。', 'error');
        });
    },
    onInvalidFile: (message) => showToast(message, 'error'),
  });

  const workspace = h('div', { className: 'split-layout' }, [
    h('div', { className: 'split-canvas-wrapper' }, [
      canvas,
      methodLabel,
      h('div', { className: 'toolbar' }, [zoomOutButton, zoomInButton, zoomResetButton]),
    ]),
    h('div', { className: 'split-side-panel' }, [
      createSectionHeading('検出パラメータ'),
      bgThreshold.element,
      minArea.element,
      equalDivisionField,
      h('div', { className: 'toolbar' }, [redetectButton, eyedropperButton]),
      resetAllButton,
      createSectionHeading('選択中のセル'),
      selectionPanel,
      createSectionHeading('警告'),
      warningList,
    ]),
  ]);
  workspace.hidden = true;

  const exportSection = h('div', { className: 'export-section' }, [
    createSectionHeading('全体設定'),
    h('div', { className: 'settings-form' }, [
      outputWidthSlider.element,
      outputHeightSlider.element,
      marginTopSlider.element,
      marginRightSlider.element,
      marginBottomSlider.element,
      marginLeftSlider.element,
      scaleSlider.element,
      offsetXSlider.element,
      offsetYSlider.element,
      alignField,
      alphaThresholdSlider.element,
      featherSlider.element,
      outlineWidthSlider.element,
      allowUpscaleField,
    ]),
    createSectionHeading('プレビュー'),
    h('div', { className: 'toolbar' }, [
      bgCheckerButton,
      bgWhiteButton,
      bgDarkButton,
      bgChatButton,
    ]),
    previewGrid,
    createSectionHeading('書き出し'),
    h('div', { className: 'toolbar' }, [exportButton, saveSettingsButton, loadSettingsButton]),
    exportIssueList,
  ]);
  exportSection.hidden = true;

  editorStore.subscribe(() => scheduleRenderAll());

  return h('div', { className: 'split-view' }, [dropzone, emptyState, workspace, exportSection]);
}
