import { h } from '../shared/dom';
import { downscaleImageData, imageDataLikeToCanvas, loadImageDataFromFile } from '../shared/imageData';
import { DEFAULT_GRID, DETECTION_MAX_DIMENSION_PX } from '../shared/lineSpec';
import { Store } from '../shared/store';
import type { ImageDataLike, RGB } from '../shared/types';
import { createDropzone } from '../ui/dropzone';
import { createSliderField } from '../ui/slider';
import { showToast } from '../ui/toast';
import {
  createEditorState,
  createEditorStateFromFrames,
  getCell,
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
import { DEFAULT_DETECTION_PARAMS, type CellWarning, type DetectionMethod, type DetectionParams, type Rect } from './types';

const VIEWPORT_WIDTH = 900;
const VIEWPORT_HEIGHT = 600;
const HANDLE_SCREEN_PX = 9;
/** これを超える辺の長さの画像は、処理に時間がかかる可能性がある旨を警告する(処理自体は続行する)。 */
const HUGE_IMAGE_WARNING_DIMENSION_PX = DETECTION_MAX_DIMENSION_PX * 2;
const STAMP_COUNT_PER_SHEET = DEFAULT_GRID.cols * DEFAULT_GRID.rows;

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type DragMode =
  | { kind: 'move'; index: number; startImageX: number; startImageY: number; startBox: Rect }
  | { kind: 'resize'; index: number; handle: ResizeHandle; startBox: Rect }
  | { kind: 'draw'; index: number; startImageX: number; startImageY: number }
  | { kind: 'pan'; startScreenX: number; startScreenY: number; startPanX: number; startPanY: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pointInBox(point: { x: number; y: number }, box: Rect): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}

function clampBoxToImage(box: Rect, image: ImageDataLike): Rect {
  const width = clamp(box.width, 1, image.width);
  const height = clamp(box.height, 1, image.height);
  const x = clamp(box.x, 0, image.width - width);
  const y = clamp(box.y, 0, image.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function applyResize(box: Rect, handle: ResizeHandle, imageX: number, imageY: number): Rect {
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

function getHandlePoints(box: Rect): Record<ResizeHandle, { x: number; y: number }> {
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

function hitTestHandle(box: Rect, imageX: number, imageY: number, tolerance: number): ResizeHandle | null {
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

function dilateBox(box: Rect, marginRatio: number, image: ImageDataLike): Rect {
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

export interface DetectViewHandle {
  element: HTMLElement;
  /**
   * ステップBから「枠を修正」で戻ってきたときに、既存の画像・枠を使って再表示する。
   * 新規にファイルを読み込む場合はドロップゾーンの操作で `onConfirm` まで進む。
   */
  openWithExisting: (image: ImageDataLike, sourceName: string, frames: Rect[]) => void;
}

/**
 * タブ②ステップA(シート画像の読み込み・自動検出・枠編集)の画面を構築する。
 * 「この枠で確定」が押されると `onConfirm` を呼び、呼び出し元(splitView.ts)がステップBへ切り替える。
 * `backgroundColor` は検出で使った(またはスポイトで指定した)背景色で、ステップBの描画にもそのまま使う。
 */
export function createDetectView(
  onConfirm: (image: ImageDataLike, sourceName: string, frames: Rect[], backgroundColor: RGB) => void,
): DetectViewHandle {
  const editorStore = new Store<EditorState | null>(null);

  let originalImage: ImageDataLike | null = null;
  let sourceName = '';
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

  const bgThreshold = createSliderField({
    label: '背景判定しきい値',
    min: 1,
    max: 80,
    step: 1,
    value: detectionParams.backgroundThreshold,
    defaultValue: DEFAULT_DETECTION_PARAMS.backgroundThreshold,
    onChange: (value) => {
      detectionParams = { ...detectionParams, backgroundThreshold: value };
    },
  });

  const minArea = createSliderField({
    label: 'ノイズ除去の最小面積',
    unit: '%',
    min: 0.001,
    max: 0.5,
    step: 0.001,
    value: Number((detectionParams.minAreaRatio * 100).toFixed(3)),
    defaultValue: Number((DEFAULT_DETECTION_PARAMS.minAreaRatio * 100).toFixed(3)),
    onChange: (value) => {
      detectionParams = { ...detectionParams, minAreaRatio: value / 100 };
    },
  });

  const equalDivisionCheckbox = h('input', { attrs: { type: 'checkbox' } });
  equalDivisionCheckbox.addEventListener('change', () => {
    useEqualDivision = equalDivisionCheckbox.checked;
  });
  const equalDivisionField = h('div', { className: 'field field--checkbox' }, [
    h('label', { className: 'checkbox-field' }, [equalDivisionCheckbox, ' 自動検出の代わりに均等分割を使う']),
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
    text: '枠の編集をリセット',
    on: {
      click: () => {
        editorStore.setState((s) => (s ? resetAllCells(s) : s));
        showToast('直近の検出結果に戻しました。');
      },
    },
  });

  const confirmButton = h('button', {
    className: 'button button--primary',
    attrs: { type: 'button' },
    text: 'この枠で確定',
    on: {
      click: () => {
        const editor = editorStore.getState();
        if (!editor || !originalImage) {
          showToast('先にシート画像を読み込んでください。', 'error');
          return;
        }
        const frames: Rect[] = editor.cells.map((cell) => cell.box);
        onConfirm(originalImage, sourceName, frames, lastBackgroundColor);
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
  for (let i = 1; i <= STAMP_COUNT_PER_SHEET; i += 1) {
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
        editorStore.setState((s) => (s ? swapCells(s, editor.selectedIndex as number, targetIndex) : s));
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
    try {
      const detectionSource = downscaleImageData(originalImage, DETECTION_MAX_DIMENSION_PX);
      const scaleToOriginal = originalImage.width / detectionSource.width;
      lastBackgroundColor = detectionParams.backgroundColor ?? estimateBackgroundColor(detectionSource);

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
    } catch {
      showToast('検出に失敗しました。パラメータを変えて再検出するか、均等分割をお試しください。', 'error');
    }
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

  function updateSelectionPanel(editor: EditorState): void {
    selectionPanel.replaceChildren();
    if (editor.selectedIndex === null) {
      selectionPanel.append(h('p', { className: 'field__hint', text: '枠をクリックすると選択できます。' }));
      return;
    }
    const cell = getCell(editor, editor.selectedIndex);
    if (!cell) {
      return;
    }
    selectionPanel.append(
      h('p', { text: `選択中: No.${cell.index + 1}${cell.isManuallyEdited ? '(手動編集済み)' : ''}` }),
      h('div', { className: 'toolbar' }, [fitButton, resetSelectedButton]),
      h('div', { className: 'toolbar' }, [numberSelect, swapButton]),
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
    const selected = editor.selectedIndex !== null ? getCell(editor, editor.selectedIndex) : undefined;

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
      dragMode = { kind: 'draw', index: editor.selectedIndex, startImageX: imagePoint.x, startImageY: imagePoint.y };
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    dragMode = { kind: 'pan', startScreenX: screenX, startScreenY: screenY, startPanX: camera.panX, startPanY: camera.panY };
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
      const box = clampBoxToImage(applyResize(dragMode.startBox, dragMode.handle, imagePoint.x, imagePoint.y), originalImage);
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

  function loadImage(image: ImageDataLike, name: string): void {
    originalImage = image;
    sourceName = name;
    cachedCanvas = imageDataLikeToCanvas(image);
    baseScale = Math.min(VIEWPORT_WIDTH / image.width, VIEWPORT_HEIGHT / image.height, 1) || 1;
    camera.zoom = 1;
    camera.panX = 0;
    camera.panY = 0;
    emptyState.hidden = true;
    workspace.hidden = false;
  }

  const dropzone = createDropzone({
    label: 'シート画像をドラッグ&ドロップ、またはクリックして選択',
    hint: 'PNG/JPEG/WebP。6列×4行(24個)のスタンプが並んだシート画像を選んでください。',
    onFile: (file) => {
      void loadImageDataFromFile(file)
        .then((image) => {
          if (Math.max(image.width, image.height) > HUGE_IMAGE_WARNING_DIMENSION_PX) {
            showToast(`画像がかなり大きいです(${image.width}×${image.height}px)。処理に時間がかかる場合があります。`, 'error');
          }
          loadImage(image, file.name);
          runDetection();
        })
        .catch(() => {
          showToast('画像の読み込みに失敗しました。ファイルが壊れていないか、画像が大きすぎないか確認してください。', 'error');
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
      h('div', { className: 'toolbar' }, [confirmButton]),
    ]),
  ]);
  workspace.hidden = true;

  function openWithExisting(image: ImageDataLike, name: string, frames: Rect[]): void {
    loadImage(image, name);
    lastBackgroundColor =
      detectionParams.backgroundColor ?? estimateBackgroundColor(downscaleImageData(image, DETECTION_MAX_DIMENSION_PX));
    lastMethod = null; // 既存の確定済み枠を再表示しているだけなので、検出方式ラベルは出さない
    editorStore.setState(createEditorStateFromFrames(frames));
  }

  return {
    element: h('div', { className: 'split-view' }, [dropzone, emptyState, workspace]),
    openWithExisting,
  };
}
