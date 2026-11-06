import { keepOriginalAlpha, removeBackground } from '../export/alpha';
import { alignEraseMaskToCrop, applyEraseMask } from '../export/erase';
import {
  computeEffectiveFrame,
  cropWithForcedBackground,
  renderStamp,
} from '../export/renderStamp';
import { h, isEditableEventTarget } from '../shared/dom';
import { imageDataLikeToCanvas } from '../shared/imageData';
import type { ImageDataLike, RGB } from '../shared/types';
import { createSliderField } from '../ui/slider';
import { resolvePointerDownIntent } from './detectView';
import { applyBrushStamp, interpolateBrushPoints, type BrushMode } from './eraseBrush';
import {
  canRedo,
  canUndo,
  createHistory,
  push as pushHistory,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from './history';
import {
  type BackgroundMode,
  type EraseMask,
  type GlobalSettings,
  type PreviewSettings,
  type Rect,
  type StampAdjust,
} from './types';

const VIEWPORT_SIZE = 460;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 16;
const BRUSH_SIZE_MIN = 1;
const BRUSH_SIZE_MAX = 100;
const BRUSH_SIZE_DEFAULT = 30;
const HARDNESS_DEFAULT = 50;
/** ブラシの軌跡を途切れさせないための補間間隔(画面px)。 */
const PAINT_STEP_SCREEN_PX = 3;

type CanvasBackgroundMode = 'checker' | 'black' | 'white' | 'confirm';

type DragMode =
  | { kind: 'pan'; startScreenX: number; startScreenY: number; startPanX: number; startPanY: number }
  | { kind: 'paint'; mode: BrushMode };

export interface EraseEditorOpenParams {
  /** 0始まりのスタンプ番号。 */
  index: number;
  /** 採用元シートの元画像(シート絶対座標系)。 */
  sourceImage: ImageDataLike;
  /** 検出枠(crop適用前、シート絶対座標)。 */
  frame: Rect;
  /** 解決済みの個別設定(crop・背景透過後の見た目を揃えるために使う)。 */
  adjust: StampAdjust;
  globalSettings: GlobalSettings;
  backgroundColor: RGB;
  backgroundMode: BackgroundMode;
  /** 既存の消去マスク(シート絶対座標)。なければ未編集として開く。 */
  existingMask: EraseMask | undefined;
  /** 現在の確認用背景(初期表示の背景に使う)。 */
  initialBackground: PreviewSettings;
  /** 「完了」が押されたときに呼ばれる。マスクが空の場合はnullを渡す(保存しない)。 */
  onComplete: (mask: EraseMask | null) => void;
}

export interface EraseEditorHandle {
  element: HTMLElement;
  open: (params: EraseEditorOpenParams) => void;
}

interface Session {
  params: EraseEditorOpenParams;
  /** 切り出し範囲の左上(シート絶対座標)。マスクはこの原点からの相対(ローカル)座標で保持する。 */
  cropOriginX: number;
  cropOriginY: number;
  /** 背景透過後(消しゴム適用前)の作業用画像。消しゴムはこの上に適用した結果を表示する。 */
  matted: ImageDataLike;
  mattedCanvas: HTMLCanvasElement;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** マスク(0〜255)から、消去範囲を示す半透明の赤いオーバーレイ画像を作る。 */
function buildOverlayImage(mask: Uint8ClampedArray, width: number, height: number): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    const value = mask[p] ?? 0;
    if (value <= 0) {
      continue;
    }
    const i = p * 4;
    data[i] = 255;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = Math.round(value * 0.5);
  }
  return { width, height, data };
}

/**
 * タブ②の手動消しゴム編集画面(全画面ダイアログ)。選択中スタンプの「背景透過後・ゴミ除去前」
 * の画像に対して、消しゴム(アルファを0〜255で減衰させるマスク)を描き込む。
 * マスクはシート絶対座標で保持する(追加修正指示書 第5弾 項目19)。ズーム・パンは
 * `detectView.ts`のステップA画面と同じ操作感にしている。
 */
export function createEraseEditor(): EraseEditorHandle {
  let session: Session | null = null;
  let mask = new Uint8ClampedArray(0);
  let history: History<Uint8ClampedArray> | null = null;
  let maskCanvas: HTMLCanvasElement | null = null;
  let overlayCanvas: HTMLCanvasElement | null = null;

  let tool: BrushMode = 'erase';
  let brushSizeScreenPx = BRUSH_SIZE_DEFAULT;
  let hardnessPercent = HARDNESS_DEFAULT;
  let showOverlay = false;
  let bgMode: CanvasBackgroundMode = 'confirm';
  let confirmColor = '#ffffff';

  const camera = { zoom: 1, panX: 0, panY: 0 };
  let baseScale = 1;
  let dragMode: DragMode | null = null;
  let spacePressed = false;
  let lastPaintPoint: { x: number; y: number } | null = null;
  let lastStrokeEndPoint: { x: number; y: number } | null = null;
  let strokeDirty = false;
  let redrawScheduled = false;

  function getScale(): number {
    return baseScale * camera.zoom;
  }

  function screenToImage(screenX: number, screenY: number): { x: number; y: number } {
    const scale = getScale();
    return { x: camera.panX + screenX / scale, y: camera.panY + screenY / scale };
  }

  function updateHistoryButtons(): void {
    undoButton.toggleAttribute('disabled', !(history && canUndo(history)));
    redoButton.toggleAttribute('disabled', !(history && canRedo(history)));
  }

  /** マスクの見た目(消去後の画像+オーバーレイ)を作り直す。ストローク中はこれだけを再計算する。 */
  function rebuildMaskLayers(): void {
    if (!session) {
      return;
    }
    const { matted } = session;
    const erased = applyEraseMask(matted, {
      x: 0,
      y: 0,
      width: matted.width,
      height: matted.height,
      data: mask,
    });
    maskCanvas = imageDataLikeToCanvas(erased);
    overlayCanvas = showOverlay
      ? imageDataLikeToCanvas(buildOverlayImage(mask, matted.width, matted.height))
      : null;
  }

  function renderWorking(): void {
    const ctx = workingCanvas.getContext('2d');
    if (!ctx || !session || !maskCanvas) {
      return;
    }
    const scale = getScale();
    ctx.clearRect(0, 0, workingCanvas.width, workingCanvas.height);
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-camera.panX, -camera.panY);
    ctx.drawImage(maskCanvas, 0, 0);
    if (overlayCanvas) {
      ctx.drawImage(overlayCanvas, 0, 0);
    }
    ctx.restore();
  }

  function renderFinal(): void {
    if (!session) {
      return;
    }
    const { params, cropOriginX, cropOriginY, matted } = session;
    const activeMask: EraseMask = {
      x: cropOriginX,
      y: cropOriginY,
      width: matted.width,
      height: matted.height,
      data: mask,
    };
    try {
      const rendered = renderStamp(
        params.sourceImage,
        params.frame,
        params.backgroundColor,
        params.globalSettings,
        params.adjust,
        params.backgroundMode,
        activeMask,
      );
      drawToCanvas(finalCanvas, rendered);
    } catch {
      // 最終結果プレビューの生成に失敗しても、作業自体は続けられるようにする。
    }
  }

  function scheduleWorkingRedraw(): void {
    if (redrawScheduled) {
      return;
    }
    redrawScheduled = true;
    window.requestAnimationFrame(() => {
      redrawScheduled = false;
      rebuildMaskLayers();
      renderWorking();
    });
  }

  function applyCanvasBackground(canvas: HTMLCanvasElement): void {
    canvas.classList.remove('erase-editor__canvas--dark', 'erase-editor__canvas--checker');
    canvas.style.backgroundColor = '';
    if (bgMode === 'checker') {
      canvas.classList.add('erase-editor__canvas--checker');
    } else if (bgMode === 'black') {
      canvas.classList.add('erase-editor__canvas--dark');
    } else if (bgMode === 'white') {
      canvas.style.backgroundColor = '#ffffff';
    } else {
      canvas.style.backgroundColor = confirmColor;
    }
  }

  function updateBackgroundButtons(): void {
    bgCheckerButton.classList.toggle('button--active', bgMode === 'checker');
    bgBlackButton.classList.toggle('button--active', bgMode === 'black');
    bgWhiteButton.classList.toggle('button--active', bgMode === 'white');
    bgConfirmButton.classList.toggle('button--active', bgMode === 'confirm');
    applyCanvasBackground(workingCanvas);
    applyCanvasBackground(finalCanvas);
  }

  function setBgMode(mode: CanvasBackgroundMode): void {
    bgMode = mode;
    updateBackgroundButtons();
  }

  function setTool(next: BrushMode): void {
    tool = next;
    eraserToolButton.classList.toggle('button--active', tool === 'erase');
    restoreToolButton.classList.toggle('button--active', tool === 'restore');
  }

  function setBrushSize(next: number): void {
    brushSizeScreenPx = clamp(Math.round(next), BRUSH_SIZE_MIN, BRUSH_SIZE_MAX);
    brushSizeSlider.setValue(brushSizeScreenPx);
  }

  /** 現在のマスクを1手として履歴に積む(ストローク終了時に呼ぶ)。 */
  function commitStroke(): void {
    if (!history) {
      return;
    }
    history = pushHistory(history, new Uint8ClampedArray(mask));
    updateHistoryButtons();
  }

  function restoreMaskFrom(snapshot: Uint8ClampedArray): void {
    mask = new Uint8ClampedArray(snapshot);
    rebuildMaskLayers();
    renderWorking();
    renderFinal();
  }

  function handleUndo(): void {
    if (!history || !canUndo(history)) {
      return;
    }
    history = undoHistory(history);
    restoreMaskFrom(history.present);
    updateHistoryButtons();
  }

  function handleRedo(): void {
    if (!history || !canRedo(history)) {
      return;
    }
    history = redoHistory(history);
    restoreMaskFrom(history.present);
    updateHistoryButtons();
  }

  function paintAt(point: { x: number; y: number }, mode: BrushMode): void {
    if (!session) {
      return;
    }
    const radiusImagePx = brushSizeScreenPx / 2 / getScale();
    applyBrushStamp(
      mask,
      session.matted.width,
      session.matted.height,
      point.x,
      point.y,
      radiusImagePx,
      hardnessPercent / 100,
      mode,
    );
  }

  function paintStroke(from: { x: number; y: number }, to: { x: number; y: number }, mode: BrushMode): void {
    const scale = getScale();
    const stepImagePx = PAINT_STEP_SCREEN_PX / scale;
    paintAt(from, mode);
    interpolateBrushPoints(from, to, stepImagePx).forEach((p) => paintAt(p, mode));
  }

  function resetView(): void {
    if (!session) {
      return;
    }
    const { matted } = session;
    baseScale = Math.min(VIEWPORT_SIZE / matted.width, VIEWPORT_SIZE / matted.height);
    camera.zoom = 1;
    camera.panX = 0;
    camera.panY = 0;
  }

  function setZoom(nextZoom: number): void {
    camera.zoom = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
    renderWorking();
  }

  // ---- DOM構築 ----

  const titleEl = h('h2', { className: 'erase-editor__title' });

  const eraserToolButton = h('button', {
    className: 'button button--active',
    attrs: { type: 'button' },
    text: '消しゴム (E)',
    on: { click: () => setTool('erase') },
  });
  const restoreToolButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '復元 (R)',
    on: { click: () => setTool('restore') },
  });

  const brushSizeSlider = createSliderField({
    label: 'ブラシサイズ',
    unit: 'px',
    min: BRUSH_SIZE_MIN,
    max: BRUSH_SIZE_MAX,
    step: 1,
    value: BRUSH_SIZE_DEFAULT,
    defaultValue: BRUSH_SIZE_DEFAULT,
    onChange: (v) => {
      brushSizeScreenPx = v;
    },
  });
  const hardnessSlider = createSliderField({
    label: '硬さ',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    value: HARDNESS_DEFAULT,
    defaultValue: HARDNESS_DEFAULT,
    onChange: (v) => {
      hardnessPercent = v;
    },
  });

  const overlayCheckbox = h('input', { attrs: { type: 'checkbox' } });
  overlayCheckbox.addEventListener('change', () => {
    showOverlay = overlayCheckbox.checked;
    rebuildMaskLayers();
    renderWorking();
  });
  const overlayField = h('div', { className: 'field field--checkbox' }, [
    h('label', { className: 'checkbox-field' }, [overlayCheckbox, ' 消去範囲を表示']),
  ]);

  const bgCheckerButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '市松',
    on: { click: () => setBgMode('checker') },
  });
  const bgBlackButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '黒',
    on: { click: () => setBgMode('black') },
  });
  const bgWhiteButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '白',
    on: { click: () => setBgMode('white') },
  });
  const bgConfirmButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '確認用背景',
    on: { click: () => setBgMode('confirm') },
  });

  const undoButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '元に戻す',
    on: { click: () => handleUndo() },
  });
  const redoButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: 'やり直す',
    on: { click: () => handleRedo() },
  });

  const resetAllButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: 'すべて元に戻す(リセット)',
    on: {
      click: () => {
        if (!window.confirm('この1枚の消しゴムの編集をすべて元に戻します。よろしいですか?')) {
          return;
        }
        mask.fill(0);
        commitStroke();
        rebuildMaskLayers();
        renderWorking();
        renderFinal();
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
        resetView();
        renderWorking();
      },
    },
  });

  const workingCanvas = h('canvas', {
    className: 'erase-editor__canvas',
    attrs: {
      width: String(VIEWPORT_SIZE),
      height: String(VIEWPORT_SIZE),
      tabindex: '0',
    },
  });
  const finalCanvas = h('canvas', { className: 'erase-editor__canvas erase-editor__canvas--final' });

  const cancelButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: 'キャンセル',
    on: { click: () => dialog.close() },
  });
  const completeButton = h('button', {
    className: 'button button--primary',
    attrs: { type: 'button' },
    text: '完了',
    on: {
      click: () => {
        if (!session) {
          dialog.close();
          return;
        }
        const isEmpty = !mask.some((v) => v > 0);
        const result: EraseMask | null = isEmpty
          ? null
          : {
              x: session.cropOriginX,
              y: session.cropOriginY,
              width: session.matted.width,
              height: session.matted.height,
              data: new Uint8ClampedArray(mask),
            };
        const onComplete = session.params.onComplete;
        dialog.close();
        onComplete(result);
      },
    },
  });

  const dialog = h('dialog', { className: 'erase-editor' }, [
    h('div', { className: 'erase-editor__header' }, [titleEl]),
    h('div', { className: 'erase-editor__toolbar' }, [
      h('div', { className: 'toolbar' }, [eraserToolButton, restoreToolButton]),
      brushSizeSlider.element,
      hardnessSlider.element,
      overlayField,
      h('div', { className: 'toolbar' }, [bgCheckerButton, bgBlackButton, bgWhiteButton, bgConfirmButton]),
      h('div', { className: 'toolbar' }, [undoButton, redoButton, resetAllButton]),
      h('div', { className: 'toolbar' }, [zoomOutButton, zoomInButton, zoomResetButton]),
    ]),
    h('p', {
      className: 'field__hint',
      text: '操作: ドラッグで塗る / Shift+クリックで直線 / スペース+ドラッグで移動 / ホイールで拡大縮小 / [ ] でブラシサイズ変更',
    }),
    h('div', { className: 'erase-editor__canvases' }, [
      h('div', { className: 'erase-editor__canvas-col' }, [
        h('p', { className: 'split-method-label', text: '作業中の画像' }),
        workingCanvas,
      ]),
      h('div', { className: 'erase-editor__canvas-col' }, [
        h('p', { className: 'split-method-label', text: 'プレビュー: 最終結果' }),
        finalCanvas,
      ]),
    ]),
    h('div', { className: 'csv-dialog__actions' }, [cancelButton, completeButton]),
  ]);
  document.body.append(dialog);

  workingCanvas.addEventListener('pointerdown', (event) => {
    if (!session) {
      return;
    }
    const rect = workingCanvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    if (resolvePointerDownIntent(spacePressed, event.button) === 'pan') {
      event.preventDefault();
      dragMode = {
        kind: 'pan',
        startScreenX: screenX,
        startScreenY: screenY,
        startPanX: camera.panX,
        startPanY: camera.panY,
      };
      workingCanvas.setPointerCapture(event.pointerId);
      workingCanvas.style.cursor = 'grabbing';
      return;
    }

    const imagePoint = screenToImage(screenX, screenY);

    if (event.shiftKey && lastStrokeEndPoint) {
      paintStroke(lastStrokeEndPoint, imagePoint, tool);
      lastStrokeEndPoint = imagePoint;
      commitStroke();
      rebuildMaskLayers();
      renderWorking();
      renderFinal();
      return;
    }

    paintAt(imagePoint, tool);
    lastPaintPoint = imagePoint;
    strokeDirty = true;
    dragMode = { kind: 'paint', mode: tool };
    workingCanvas.setPointerCapture(event.pointerId);
    scheduleWorkingRedraw();
  });

  workingCanvas.addEventListener('pointermove', (event) => {
    if (!dragMode || !session) {
      return;
    }
    const rect = workingCanvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    if (dragMode.kind === 'pan') {
      const scale = getScale();
      camera.panX = dragMode.startPanX - (screenX - dragMode.startScreenX) / scale;
      camera.panY = dragMode.startPanY - (screenY - dragMode.startScreenY) / scale;
      renderWorking();
      return;
    }

    const imagePoint = screenToImage(screenX, screenY);
    if (lastPaintPoint) {
      paintStroke(lastPaintPoint, imagePoint, dragMode.mode);
    }
    lastPaintPoint = imagePoint;
    scheduleWorkingRedraw();
  });

  function updateIdleCursor(): void {
    if (dragMode) {
      return;
    }
    workingCanvas.style.cursor = spacePressed ? 'grab' : 'crosshair';
  }

  workingCanvas.addEventListener('pointerup', (event) => {
    const wasPainting = dragMode?.kind === 'paint';
    dragMode = null;
    workingCanvas.releasePointerCapture(event.pointerId);
    updateIdleCursor();
    if (wasPainting && strokeDirty) {
      lastStrokeEndPoint = lastPaintPoint;
      strokeDirty = false;
      commitStroke();
      rebuildMaskLayers();
      renderWorking();
      renderFinal();
    }
    lastPaintPoint = null;
  });
  workingCanvas.addEventListener('pointercancel', () => {
    dragMode = null;
    lastPaintPoint = null;
    updateIdleCursor();
  });

  workingCanvas.addEventListener(
    'wheel',
    (event) => {
      if (!session) {
        return;
      }
      event.preventDefault();
      const rect = workingCanvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const before = screenToImage(screenX, screenY);
      const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
      camera.zoom = clamp(camera.zoom * zoomFactor, ZOOM_MIN, ZOOM_MAX);
      const scale = getScale();
      camera.panX = before.x - screenX / scale;
      camera.panY = before.y - screenY / scale;
      renderWorking();
    },
    { passive: false },
  );

  window.addEventListener('keydown', (event) => {
    if (!dialog.open || isEditableEventTarget(event.target)) {
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      if (!spacePressed) {
        spacePressed = true;
        updateIdleCursor();
      }
      return;
    }
    const withModifier = event.ctrlKey || event.metaKey;
    if (withModifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
      return;
    }
    if (withModifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      handleRedo();
      return;
    }
    if (withModifier) {
      return;
    }
    if (event.key === '[') {
      setBrushSize(brushSizeScreenPx - 5);
    } else if (event.key === ']') {
      setBrushSize(brushSizeScreenPx + 5);
    } else if (event.key.toLowerCase() === 'e') {
      setTool('erase');
    } else if (event.key.toLowerCase() === 'r') {
      setTool('restore');
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code !== 'Space') {
      return;
    }
    spacePressed = false;
    updateIdleCursor();
  });

  dialog.addEventListener('close', () => {
    session = null;
    history = null;
    dragMode = null;
    lastPaintPoint = null;
    lastStrokeEndPoint = null;
  });

  function open(params: EraseEditorOpenParams): void {
    const effectiveFrame = computeEffectiveFrame(params.frame, params.adjust.crop);
    const marginPx = params.globalSettings.featherPx + 2;
    const cropped = cropWithForcedBackground(
      params.sourceImage,
      effectiveFrame,
      marginPx,
      params.backgroundColor,
      params.backgroundMode,
    );
    const matted =
      params.backgroundMode === 'transparent'
        ? keepOriginalAlpha(cropped)
        : removeBackground(
            cropped,
            params.backgroundColor,
            params.globalSettings.alphaThreshold,
            params.globalSettings.featherPx,
          );
    const cropOriginX = Math.round(effectiveFrame.x) - marginPx;
    const cropOriginY = Math.round(effectiveFrame.y) - marginPx;

    session = { params, cropOriginX, cropOriginY, matted, mattedCanvas: imageDataLikeToCanvas(matted) };

    const aligned = alignEraseMaskToCrop(
      params.existingMask,
      cropOriginX,
      cropOriginY,
      matted.width,
      matted.height,
    );
    mask = aligned ? new Uint8ClampedArray(aligned.data) : new Uint8ClampedArray(matted.width * matted.height);
    history = createHistory(new Uint8ClampedArray(mask));
    updateHistoryButtons();

    lastPaintPoint = null;
    lastStrokeEndPoint = null;
    strokeDirty = false;

    titleEl.textContent = `No.${params.index + 1} を手動で消す`;
    setTool('erase');
    setBrushSize(BRUSH_SIZE_DEFAULT);
    hardnessPercent = HARDNESS_DEFAULT;
    hardnessSlider.setValue(HARDNESS_DEFAULT);
    overlayCheckbox.checked = false;
    showOverlay = false;
    confirmColor = params.initialBackground.mode === 'color' ? params.initialBackground.color : '#ffffff';
    bgMode = params.initialBackground.mode === 'color' ? 'confirm' : 'checker';
    updateBackgroundButtons();

    resetView();
    rebuildMaskLayers();
    renderWorking();
    renderFinal();

    dialog.showModal();
  }

  return { element: dialog, open };
}
