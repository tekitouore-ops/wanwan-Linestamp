import { h, isEditableEventTarget } from '../shared/dom';
import {
  downscaleImageData,
  imageDataLikeToCanvas,
  loadImageDataFromFile,
} from '../shared/imageData';
import { DEFAULT_GRID, DETECTION_MAX_DIMENSION_PX } from '../shared/lineSpec';
import { Store } from '../shared/store';
import type { ImageDataLike, RGB } from '../shared/types';
import { createDropzone } from '../ui/dropzone';
import { createSliderField } from '../ui/slider';
import { showToast } from '../ui/toast';
import {
  HANDLE_HIT_RADIUS_SCREEN_PX,
  HANDLE_SIZE_SCREEN_PX,
  applyResize,
  computeVisibleHandles,
  cursorForHandle,
  getHandlePoints,
  hitTestHandle,
  type ResizeHandle,
  type ResizeModifiers,
} from './boxResize';
import {
  applyEditorStateToSheet,
  createEditorStateFromFrames,
  createEmptyEditorState,
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
import {
  canRedo,
  canUndo,
  createHistory,
  push as pushHistory,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from './history';
import { detectIsTransparentImage, estimateBackgroundColor } from './mask';
import {
  addSheet,
  createSheetStore,
  getSheet,
  getSheetImage,
  MAX_SHEETS,
  removeSheet,
  renameSheet,
  reorderSheet,
  updateSheet,
  type SheetStore,
} from './sheetStore';
import { createSheetTabs } from './sheetTabs';
import {
  DEFAULT_DETECTION_PARAMS,
  type CellWarning,
  type DetectionMethod,
  type DetectionParams,
  type Rect,
  type Sheet,
} from './types';

const VIEWPORT_WIDTH = 900;
const VIEWPORT_HEIGHT = 600;
/** これを超える辺の長さの画像は、処理に時間がかかる可能性がある旨を警告する(処理自体は続行する)。 */
const HUGE_IMAGE_WARNING_DIMENSION_PX = DETECTION_MAX_DIMENSION_PX * 2;
const STAMP_COUNT_PER_SHEET = DEFAULT_GRID.cols * DEFAULT_GRID.rows;
/** 枠外を暗くするオーバーレイの不透明度(追加修正指示書 第6弾 項目22)。 */
const DARKEN_OUTSIDE_ALPHA = 0.2;

type DragMode =
  | { kind: 'move'; index: number; startImageX: number; startImageY: number; startBox: Rect }
  | { kind: 'resize'; index: number; handle: ResizeHandle; startBox: Rect }
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

function pointInBox(point: { x: number; y: number }, box: Rect): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function clampBoxToImage(box: Rect, image: ImageDataLike): Rect {
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

/**
 * ポインター押下時に、どの操作として扱うかを決める。スペース押下中、またはホイール(中)ボタンでの
 * 押下は、選択状態や押下位置にかかわらず常にパン優先にする(修正指示書 項目2)。
 * DOM非依存の純粋関数として切り出し、優先順位をテストできるようにしてある。
 */
export function resolvePointerDownIntent(spacePressed: boolean, button: number): 'pan' | 'other' {
  return spacePressed || button === 1 ? 'pan' : 'other';
}

function defaultDetectSettings(): DetectionParams {
  return { ...DEFAULT_DETECTION_PARAMS, cols: DEFAULT_GRID.cols, rows: DEFAULT_GRID.rows };
}

export interface DetectViewHandle {
  element: HTMLElement;
  /**
   * ステップBから「枠を修正」で戻ってきたときに、既存のシート一式をそのまま再表示する。
   * 新規にファイルを読み込む場合はドロップゾーンの操作で `onConfirm` まで進む。
   */
  openWithExisting: (store: SheetStore, activeSheetId?: string | null) => void;
}

/**
 * タブ②ステップA(シート画像の読み込み・シートタブ切替・自動検出・枠編集)の画面を構築する。
 * 複数シートを管理し、「この枠で確定」が押されるとアクティブなシートの編集結果を書き戻した上で
 * `onConfirm` にシート一式(SheetStore)を渡す。呼び出し元(splitView.ts)がステップBへ切り替える。
 */
export function createDetectView(onConfirm: (store: SheetStore) => void): DetectViewHandle {
  let store: SheetStore = createSheetStore();
  let activeSheetId: string | null = null;
  const editorStore = new Store<EditorState | null>(null);
  /**
   * ステップAの枠編集(移動・リサイズ・入れ替え・リセット等)用のUndo/Redo履歴(修正指示書 項目4)。
   * ステップBの履歴とは別の独立したスタック。シート切り替え・再検出など「土台が変わる」操作では
   * 作り直す(そのシートの編集セッションが変わるため、履歴を引き継がない)。
   */
  let editorHistory: History<EditorState> | null = null;

  let cachedCanvas: HTMLCanvasElement | null = null;
  let baseScale = 1;
  let dragMode: DragMode | null = null;
  let eyedropperActive = false;
  /** スペースキーが押されている間は、枠の選択状態にかかわらずドラッグをパンにする。 */
  let spacePressed = false;
  const camera = { zoom: 1, panX: 0, panY: 0 };
  /** ドラッグしていないときに、ポインタが乗っているハンドル(ハイライト・カーソル切替用)。 */
  let hoveredHandle: ResizeHandle | null = null;
  /** ドラッグしていないときに、ポインタが選択中の枠の内側にあるか(moveカーソル用)。 */
  let hoveredInsideSelected = false;
  /** 「枠外を暗くする」トグル(既定ON。追加修正指示書 第6弾 項目22)。 */
  let darkenOutside = true;

  /** シートごとの「均等分割を使うか」「直近の検出方式ラベル」(保存JSON・Sheet型には含めないUIのみの状態)。 */
  const uiStateBySheet = new Map<
    string,
    { useEqualDivision: boolean; lastMethod: DetectionMethod | null }
  >();

  function getActiveSheet(): Sheet | undefined {
    return activeSheetId ? getSheet(store, activeSheetId) : undefined;
  }

  function getActiveImage(): ImageDataLike | undefined {
    return activeSheetId ? getSheetImage(store, activeSheetId) : undefined;
  }

  function getActiveUiState(): { useEqualDivision: boolean; lastMethod: DetectionMethod | null } {
    const id = activeSheetId ?? '';
    const existing = uiStateBySheet.get(id);
    if (existing) {
      return existing;
    }
    const created = { useEqualDivision: false, lastMethod: null };
    uiStateBySheet.set(id, created);
    return created;
  }

  function updateEditorHistoryButtons(): void {
    undoCellButton.toggleAttribute('disabled', !(editorHistory && canUndo(editorHistory)));
    redoCellButton.toggleAttribute('disabled', !(editorHistory && canRedo(editorHistory)));
  }

  /**
   * 現在のエディタ状態を1手として履歴へコミットする。移動・リサイズは`pointerup`(操作終了)で、
   * 入れ替え・リセット等のボタン操作は押下時に呼ぶ(ドラッグ中の`pointermove`では呼ばない)。
   */
  function commitEditorHistory(): void {
    const current = editorStore.getState();
    if (!current || !editorHistory) {
      return;
    }
    editorHistory = pushHistory(editorHistory, current);
    updateEditorHistoryButtons();
  }

  /** シート切り替え・再検出など、編集の土台が変わるときに履歴を作り直す。 */
  function resetEditorHistory(state: EditorState): void {
    editorHistory = createHistory(state);
    updateEditorHistoryButtons();
  }

  function undoCellEdit(): void {
    if (!editorHistory || !canUndo(editorHistory)) {
      return;
    }
    editorHistory = undoHistory(editorHistory);
    editorStore.setState(editorHistory.present);
    updateEditorHistoryButtons();
  }

  function redoCellEdit(): void {
    if (!editorHistory || !canRedo(editorHistory)) {
      return;
    }
    editorHistory = redoHistory(editorHistory);
    editorStore.setState(editorHistory.present);
    updateEditorHistoryButtons();
  }

  const emptyState = h('p', {
    className: 'placeholder',
    text: 'シート画像をアップロードすると、ここに自動検出された24個の枠が表示されます。複数枚まとめて読み込むこともできます。',
  });

  const canvas = h('canvas', {
    className: 'split-canvas',
    attrs: { width: String(VIEWPORT_WIDTH), height: String(VIEWPORT_HEIGHT), tabindex: '0' },
  });

  const methodLabel = h('p', { className: 'split-method-label' });
  const backgroundModeLabel = h('p', { className: 'split-method-label' });
  const warningList = h('ul', { className: 'warning-list' });
  const selectionPanel = h('div', { className: 'selection-panel' });

  const bgThreshold = createSliderField({
    label: '背景判定しきい値',
    min: 1,
    max: 80,
    step: 1,
    value: DEFAULT_DETECTION_PARAMS.backgroundThreshold,
    defaultValue: DEFAULT_DETECTION_PARAMS.backgroundThreshold,
    onChange: (value) => {
      const sheet = getActiveSheet();
      if (!sheet) return;
      store = updateSheet(store, sheet.id, {
        detectSettings: { ...sheet.detectSettings, backgroundThreshold: value },
      });
      runDetection();
    },
  });

  const minArea = createSliderField({
    label: 'ノイズ除去の最小面積',
    unit: '%',
    min: 0.001,
    max: 0.5,
    step: 0.001,
    value: Number((DEFAULT_DETECTION_PARAMS.minAreaRatio * 100).toFixed(3)),
    defaultValue: Number((DEFAULT_DETECTION_PARAMS.minAreaRatio * 100).toFixed(3)),
    onChange: (value) => {
      const sheet = getActiveSheet();
      if (!sheet) return;
      store = updateSheet(store, sheet.id, {
        detectSettings: { ...sheet.detectSettings, minAreaRatio: value / 100 },
      });
      runDetection();
    },
  });

  const alphaThresholdSlider = createSliderField({
    label: '前景判定しきい値(透過画像用)',
    min: 1,
    max: 80,
    step: 1,
    value: DEFAULT_DETECTION_PARAMS.alphaThreshold,
    defaultValue: DEFAULT_DETECTION_PARAMS.alphaThreshold,
    onChange: (value) => {
      const sheet = getActiveSheet();
      if (!sheet) return;
      store = updateSheet(store, sheet.id, {
        detectSettings: { ...sheet.detectSettings, alphaThreshold: value },
      });
      runDetection();
    },
  });

  const colorModeButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '背景色で処理',
    on: { click: () => setBackgroundMode('color') },
  });
  const transparentModeButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '透過画像として処理',
    on: { click: () => setBackgroundMode('transparent') },
  });

  function setBackgroundMode(mode: 'color' | 'transparent'): void {
    const sheet = getActiveSheet();
    if (!sheet) return;
    store = updateSheet(store, sheet.id, {
      detectSettings: { ...sheet.detectSettings, backgroundMode: mode },
    });
    updateBackgroundModeUi();
    runDetection();
  }

  function updateBackgroundModeUi(): void {
    const sheet = getActiveSheet();
    const mode = sheet?.detectSettings.backgroundMode ?? 'color';
    colorModeButton.classList.toggle('button--active', mode === 'color');
    transparentModeButton.classList.toggle('button--active', mode === 'transparent');
    alphaThresholdSlider.element.hidden = mode !== 'transparent';
    bgThreshold.element.hidden = mode === 'transparent';
    backgroundModeLabel.textContent =
      mode === 'transparent' ? '判定結果: 透過画像として処理中' : '判定結果: 背景色で処理中';
  }

  const equalDivisionCheckbox = h('input', { attrs: { type: 'checkbox' } });
  equalDivisionCheckbox.addEventListener('change', () => {
    getActiveUiState().useEqualDivision = equalDivisionCheckbox.checked;
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
        updateIdleCursor();
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
        commitEditorHistory();
      },
    },
  });

  const undoCellButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '元に戻す',
    on: { click: () => undoCellEdit() },
  });
  const redoCellButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: 'やり直す',
    on: { click: () => redoCellEdit() },
  });
  updateEditorHistoryButtons();

  const confirmButton = h('button', {
    className: 'button button--primary',
    attrs: { type: 'button' },
    text: 'この枠で確定',
    on: {
      click: () => {
        if (store.sheets.length === 0) {
          showToast('先にシート画像を読み込んでください。', 'error');
          return;
        }
        syncActiveEditorStateToStore();
        const incomplete = store.sheets.find(
          (sheet) => sheet.frames.length !== STAMP_COUNT_PER_SHEET,
        );
        if (incomplete) {
          showToast(`${incomplete.name} の検出が完了していません。`, 'error');
          return;
        }
        onConfirm(store);
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
  const darkBgButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '表示背景切替(市松/暗色)',
    on: { click: () => canvas.classList.toggle('split-canvas--dark') },
  });
  const darkenOutsideButton = h('button', {
    className: 'button button--active',
    attrs: { type: 'button', 'aria-pressed': 'true' },
    text: '枠外を暗くする',
    on: {
      click: () => {
        darkenOutside = !darkenOutside;
        darkenOutsideButton.classList.toggle('button--active', darkenOutside);
        darkenOutsideButton.setAttribute('aria-pressed', String(darkenOutside));
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
        editorStore.setState((s) =>
          s ? swapCells(s, editor.selectedIndex as number, targetIndex) : s,
        );
        commitEditorHistory();
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
        const image = getActiveImage();
        if (!editor || editor.selectedIndex === null || !image) {
          showToast('先に枠を選択してください。', 'error');
          return;
        }
        const cell = getCell(editor, editor.selectedIndex);
        if (!cell) {
          return;
        }
        const region = dilateBox(cell.box, 0.3, image);
        const fitted = fitBoxToContent(image, region, activeDetectionParams());
        editorStore.setState((s) => (s ? updateCellBox(s, cell.index, fitted) : s));
        commitEditorHistory();
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
        commitEditorHistory();
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

  function activeDetectionParams(): DetectionParams {
    return getActiveSheet()?.detectSettings ?? defaultDetectSettings();
  }

  /**
   * 指定したシート・画像に対して検出を実行し、`store`内のそのシートの
   * frames/frameWarnings/detectSettings(推定した背景色)を更新する。
   * アクティブなシートでなくても呼べる(複数ファイル追加時に全シートぶん検出するため)。
   */
  function detectForSheet(
    sheet: Sheet,
    image: ImageDataLike,
    useEqualDivision: boolean,
  ): DetectionMethod | null {
    try {
      const params = sheet.detectSettings;
      const detectionSource = downscaleImageData(image, DETECTION_MAX_DIMENSION_PX);
      const scaleToOriginal = image.width / detectionSource.width;

      let resolvedBackgroundColor = params.backgroundColor;
      if (params.backgroundMode === 'color' && !resolvedBackgroundColor) {
        resolvedBackgroundColor = estimateBackgroundColor(detectionSource);
      }
      const effectiveParams: DetectionParams = {
        ...params,
        backgroundColor: resolvedBackgroundColor,
      };

      const result = useEqualDivision
        ? detectGridEqualDivision(detectionSource, effectiveParams)
        : detectGrid(detectionSource, effectiveParams);

      const scaledCells = result.cells.map((cell) => ({
        ...cell,
        box: {
          x: Math.round(cell.box.x * scaleToOriginal),
          y: Math.round(cell.box.y * scaleToOriginal),
          width: Math.round(cell.box.width * scaleToOriginal),
          height: Math.round(cell.box.height * scaleToOriginal),
        },
      }));

      const nextDetectSettings = resolvedBackgroundColor
        ? { ...params, backgroundColor: resolvedBackgroundColor }
        : params;
      store = updateSheet(store, sheet.id, {
        detectSettings: nextDetectSettings,
        frames: scaledCells.map((cell) => cell.box),
        frameWarnings: scaledCells.map((cell) => cell.warnings),
      });
      return result.method;
    } catch {
      showToast(
        `${sheet.name} の検出に失敗しました。パラメータを変えて再検出するか、均等分割をお試しください。`,
        'error',
      );
      return null;
    }
  }

  /** アクティブなシートに対して再検出し、エディタ状態(枠編集画面)へ反映する。 */
  function runDetection(): void {
    const sheet = getActiveSheet();
    const image = getActiveImage();
    if (!sheet || !image) {
      return;
    }
    const uiState = getActiveUiState();
    const method = detectForSheet(sheet, image, uiState.useEqualDivision);
    if (method === null) {
      return;
    }
    uiState.lastMethod = method;
    const updatedSheet = getSheet(store, sheet.id);
    if (updatedSheet) {
      const next = createEditorStateFromFrames(updatedSheet.frames, updatedSheet.frameWarnings);
      editorStore.setState(next);
      resetEditorHistory(next);
    }
  }

  function updateMethodLabel(): void {
    const uiState = getActiveUiState();
    if (!uiState.lastMethod) {
      methodLabel.textContent = '';
      return;
    }
    if (uiState.lastMethod === 'projection') {
      methodLabel.textContent = '検出方式: 自動検出(投影法)';
    } else if (uiState.useEqualDivision) {
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
      selectionPanel.append(
        h('p', { className: 'field__hint', text: '枠をクリックすると選択できます。' }),
      );
      return;
    }
    const cell = getCell(editor, editor.selectedIndex);
    if (!cell) {
      return;
    }
    selectionPanel.append(
      h('p', {
        text: `選択中: No.${cell.index + 1}${cell.isManuallyEdited ? '(手動編集済み)' : ''}`,
      }),
      h('div', { className: 'toolbar' }, [fitButton, resetSelectedButton]),
      h('div', { className: 'toolbar' }, [numberSelect, swapButton]),
    );
  }

  function render(): void {
    const ctx = canvas.getContext('2d');
    const image = getActiveImage();
    if (!ctx || !image || !cachedCanvas) {
      return;
    }
    const editor = editorStore.getState();
    if (!editor) {
      return;
    }

    const scale = getScale();
    const selectedCell =
      editor.selectedIndex !== null ? getCell(editor, editor.selectedIndex) : undefined;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-camera.panX, -camera.panY);
    ctx.drawImage(cachedCanvas, 0, 0);

    // 選択中の枠の外側を薄く暗くし、切り出される範囲を分かりやすくする(追加修正指示書 第6弾 項目22)。
    if (darkenOutside && selectedCell) {
      const box = selectedCell.box;
      ctx.fillStyle = `rgba(0, 0, 0, ${DARKEN_OUTSIDE_ALPHA})`;
      ctx.fillRect(0, 0, image.width, box.y);
      ctx.fillRect(0, box.y + box.height, image.width, image.height - (box.y + box.height));
      ctx.fillRect(0, box.y, box.x, box.height);
      ctx.fillRect(box.x + box.width, box.y, image.width - (box.x + box.width), box.height);
    }

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

    // 選択中の枠のリサイズハンドル(画面上で固定サイズ、追加修正指示書 第6弾 項目22)。
    if (selectedCell) {
      const box = selectedCell.box;
      const visibleHandles = computeVisibleHandles(box.width * scale, box.height * scale);
      const points = getHandlePoints(box);
      const half = HANDLE_SIZE_SCREEN_PX / 2;
      visibleHandles.forEach((handle) => {
        const point = points[handle];
        const screenX = (point.x - camera.panX) * scale;
        const screenY = (point.y - camera.panY) * scale;
        const isHovered = handle === hoveredHandle;
        ctx.fillStyle = isHovered ? '#2d6cdf' : '#ffffff';
        ctx.strokeStyle = '#2d6cdf';
        ctx.lineWidth = isHovered ? 2.5 : 1.5;
        ctx.fillRect(screenX - half, screenY - half, HANDLE_SIZE_SCREEN_PX, HANDLE_SIZE_SCREEN_PX);
        ctx.strokeRect(screenX - half, screenY - half, HANDLE_SIZE_SCREEN_PX, HANDLE_SIZE_SCREEN_PX);
      });
    }

    // ドラッグ中(移動・リサイズ・新規描画)は、枠の幅・高さ(px)を枠の近くに小さく表示する。
    if (dragMode && (dragMode.kind === 'move' || dragMode.kind === 'resize' || dragMode.kind === 'draw')) {
      const draggedCell = getCell(editor, dragMode.index);
      if (draggedCell) {
        const box = draggedCell.box;
        const label = `${Math.round(box.width)}×${Math.round(box.height)}px`;
        const screenX = (box.x - camera.panX) * scale;
        const screenY = (box.y - camera.panY) * scale;
        const labelWidth = ctx.measureText(label).width + 8;
        const labelY = Math.max(0, screenY - 20);
        ctx.fillStyle = 'rgba(45, 108, 223, 0.9)';
        ctx.fillRect(screenX, labelY, labelWidth, 16);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, screenX + 4, labelY + 2);
      }
    }

    updateMethodLabel();
    updateWarningList(editor);
    updateSelectionPanel(editor);
  }

  canvas.addEventListener('pointerdown', (event) => {
    const image = getActiveImage();
    if (!image) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    // スペース押下中、またはホイール(中)ボタンでのドラッグは、選択状態にかかわらず常にパンにする。
    if (resolvePointerDownIntent(spacePressed, event.button) === 'pan') {
      event.preventDefault();
      dragMode = {
        kind: 'pan',
        startScreenX: screenX,
        startScreenY: screenY,
        startPanX: camera.panX,
        startPanY: camera.panY,
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      return;
    }

    const imagePoint = screenToImage(screenX, screenY);

    if (eyedropperActive) {
      const color = getPixelColor(image, imagePoint.x, imagePoint.y);
      const sheet = getActiveSheet();
      if (sheet) {
        store = updateSheet(store, sheet.id, {
          detectSettings: { ...sheet.detectSettings, backgroundColor: color },
        });
      }
      eyedropperActive = false;
      eyedropperButton.setAttribute('aria-pressed', 'false');
      eyedropperButton.classList.remove('button--active');
      updateIdleCursor();
      runDetection();
      showToast('背景色を指定しました。再検出しました。');
      return;
    }

    const editor = editorStore.getState();
    if (!editor) {
      return;
    }

    const scale = getScale();
    const handleTolerance = HANDLE_HIT_RADIUS_SCREEN_PX / scale;
    const selected =
      editor.selectedIndex !== null ? getCell(editor, editor.selectedIndex) : undefined;

    if (selected) {
      const handle = hitTestHandle(
        selected.box,
        imagePoint.x,
        imagePoint.y,
        handleTolerance,
        selected.box.width * scale,
        selected.box.height * scale,
      );
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

  /**
   * ドラッグしていないときの、ハンドル・枠内へのホバー状態を更新する(ハイライト・カーソル切替用)。
   * 変化があったときだけカーソル更新・再描画を行う(追加修正指示書 第6弾 項目22)。
   */
  function updateHoverState(screenX: number, screenY: number): void {
    if (eyedropperActive) {
      return;
    }
    const editor = editorStore.getState();
    const image = getActiveImage();
    const selected =
      editor && image && editor.selectedIndex !== null
        ? getCell(editor, editor.selectedIndex)
        : undefined;

    let nextHandle: ResizeHandle | null = null;
    let nextInside = false;
    if (selected && image) {
      const scale = getScale();
      const imagePoint = screenToImage(screenX, screenY);
      const handleTolerance = HANDLE_HIT_RADIUS_SCREEN_PX / scale;
      nextHandle = hitTestHandle(
        selected.box,
        imagePoint.x,
        imagePoint.y,
        handleTolerance,
        selected.box.width * scale,
        selected.box.height * scale,
      );
      nextInside = !nextHandle && pointInBox(imagePoint, selected.box);
    }

    if (nextHandle !== hoveredHandle || nextInside !== hoveredInsideSelected) {
      hoveredHandle = nextHandle;
      hoveredInsideSelected = nextInside;
      updateIdleCursor();
      render();
    }
  }

  canvas.addEventListener('pointermove', (event) => {
    const image = getActiveImage();
    if (!image) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    if (!dragMode) {
      updateHoverState(screenX, screenY);
      return;
    }

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
        image,
      );
      const targetIndex = dragMode.index;
      editorStore.setState((s) => (s ? updateCellBox(s, targetIndex, box) : s));
    } else if (dragMode.kind === 'resize') {
      const modifiers: ResizeModifiers = { shiftKey: event.shiftKey, altKey: event.altKey };
      const box = clampBoxToImage(
        applyResize(dragMode.startBox, dragMode.handle, imagePoint.x, imagePoint.y, modifiers),
        image,
      );
      const targetIndex = dragMode.index;
      editorStore.setState((s) => (s ? updateCellBox(s, targetIndex, box) : s));
    } else if (dragMode.kind === 'draw') {
      const x = Math.min(dragMode.startImageX, imagePoint.x);
      const y = Math.min(dragMode.startImageY, imagePoint.y);
      const width = Math.max(1, Math.abs(imagePoint.x - dragMode.startImageX));
      const height = Math.max(1, Math.abs(imagePoint.y - dragMode.startImageY));
      const box = clampBoxToImage({ x, y, width, height }, image);
      const targetIndex = dragMode.index;
      editorStore.setState((s) => (s ? updateCellBox(s, targetIndex, box) : s));
    }
  });

  function updateIdleCursor(): void {
    if (dragMode) {
      return;
    }
    if (spacePressed) {
      canvas.style.cursor = 'grab';
    } else if (eyedropperActive) {
      canvas.style.cursor = 'crosshair';
    } else if (hoveredHandle) {
      canvas.style.cursor = cursorForHandle(hoveredHandle);
    } else if (hoveredInsideSelected) {
      canvas.style.cursor = 'move';
    } else {
      canvas.style.cursor = '';
    }
  }

  canvas.addEventListener('pointerup', (event) => {
    const wasEditingBox =
      dragMode?.kind === 'move' || dragMode?.kind === 'resize' || dragMode?.kind === 'draw';
    dragMode = null;
    canvas.releasePointerCapture(event.pointerId);
    updateIdleCursor();
    if (wasEditingBox) {
      commitEditorHistory();
    }
    const rect = canvas.getBoundingClientRect();
    updateHoverState(event.clientX - rect.left, event.clientY - rect.top);
    render();
  });
  canvas.addEventListener('pointercancel', () => {
    dragMode = null;
    updateIdleCursor();
  });

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || isEditableEventTarget(event.target)) {
      return;
    }
    event.preventDefault(); // スペースキーでのページスクロールを防ぐ
    if (!spacePressed) {
      spacePressed = true;
      updateIdleCursor();
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.code !== 'Space') {
      return;
    }
    spacePressed = false;
    updateIdleCursor();
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!getActiveImage()) {
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
    const image = getActiveImage();
    if (!editor || editor.selectedIndex === null || !image) {
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
    const box = clampBoxToImage({ ...cell.box, x, y }, image);
    editorStore.setState((s) => (s ? updateCellBox(s, cell.index, box) : s));
    commitEditorHistory();
  });

  editorStore.subscribe(() => render());

  /** 現在のエディタ状態を、アクティブなシートの frames/frameWarnings へ書き戻す。 */
  function syncActiveEditorStateToStore(): void {
    const sheet = getActiveSheet();
    const editor = editorStore.getState();
    if (!sheet || !editor) {
      return;
    }
    store = updateSheet(store, sheet.id, applyEditorStateToSheet(sheet, editor));
  }

  /** シートを切り替える(今のシートの編集内容は先に書き戻す)。 */
  function switchToSheet(id: string): void {
    syncActiveEditorStateToStore();
    const sheet = getSheet(store, id);
    const image = getSheetImage(store, id);
    if (!sheet || !image) {
      return;
    }
    activeSheetId = id;
    cachedCanvas = imageDataLikeToCanvas(image);
    baseScale = Math.min(VIEWPORT_WIDTH / image.width, VIEWPORT_HEIGHT / image.height, 1) || 1;
    camera.zoom = 1;
    camera.panX = 0;
    camera.panY = 0;
    emptyState.hidden = true;
    workspace.hidden = false;

    const nextEditorState =
      sheet.frames.length > 0
        ? createEditorStateFromFrames(sheet.frames, sheet.frameWarnings)
        : createEmptyEditorState();
    editorStore.setState(nextEditorState);
    resetEditorHistory(nextEditorState);

    bgThreshold.setValue(sheet.detectSettings.backgroundThreshold);
    minArea.setValue(Number((sheet.detectSettings.minAreaRatio * 100).toFixed(3)));
    alphaThresholdSlider.setValue(sheet.detectSettings.alphaThreshold);
    equalDivisionCheckbox.checked = getActiveUiState().useEqualDivision;
    updateBackgroundModeUi();
    refreshSheetTabs();
    render();
  }

  function refreshSheetTabs(): void {
    sheetTabs.setSheets(store.sheets, activeSheetId);
  }

  const sheetTabs = createSheetTabs({
    onSelect: (id) => switchToSheet(id),
    onRename: (id, name) => {
      store = renameSheet(store, id, name);
      refreshSheetTabs();
    },
    onDelete: (id) => {
      const sheet = getSheet(store, id);
      if (!sheet) return;
      if (
        !window.confirm(
          `「${sheet.name}」を削除します。このシートを採用元にしているスタンプは、確定時に先頭のシートへ戻ります。よろしいですか?`,
        )
      ) {
        return;
      }
      const wasActive = id === activeSheetId;
      store = removeSheet(store, id);
      uiStateBySheet.delete(id);
      if (store.sheets.length === 0) {
        activeSheetId = null;
        workspace.hidden = true;
        emptyState.hidden = false;
        refreshSheetTabs();
        return;
      }
      if (wasActive) {
        const next = store.sheets[0];
        if (next) {
          switchToSheet(next.id);
        }
      } else {
        refreshSheetTabs();
      }
    },
    onReorder: (id, direction) => {
      store = reorderSheet(store, id, direction);
      refreshSheetTabs();
    },
    onAddMore: () => addMoreInput.click(),
  });

  function addSheetsFromFiles(files: File[]): void {
    const room = MAX_SHEETS - store.sheets.length;
    if (room <= 0) {
      showToast(`シートは最大${MAX_SHEETS}枚までです。`, 'error');
      return;
    }
    const targets = files.slice(0, room);
    if (files.length > targets.length) {
      showToast(
        `シートは最大${MAX_SHEETS}枚までのため、${files.length - targets.length}枚を無視しました。`,
        'error',
      );
    }

    let firstNewId: string | null = null;
    void (async () => {
      for (const file of targets) {
        try {
          const image = await loadImageDataFromFile(file);
          if (Math.max(image.width, image.height) > HUGE_IMAGE_WARNING_DIMENSION_PX) {
            showToast(
              `${file.name} はかなり大きいです(${image.width}×${image.height}px)。処理に時間がかかる場合があります。`,
              'error',
            );
          }
          const isTransparent = detectIsTransparentImage(image);
          const detectSettings: DetectionParams = {
            ...defaultDetectSettings(),
            backgroundMode: isTransparent ? 'transparent' : 'color',
          };
          const added = addSheet(store, file.name, image, detectSettings);
          store = added.store;
          const method = detectForSheet(added.sheet, image, false);
          uiStateBySheet.set(added.sheet.id, { useEqualDivision: false, lastMethod: method });
          if (!firstNewId) {
            firstNewId = added.sheet.id;
          }
        } catch {
          showToast(`${file.name} の読み込みに失敗しました。`, 'error');
        }
      }
      if (firstNewId) {
        switchToSheet(firstNewId);
      }
    })();
  }

  const dropzone = createDropzone({
    label: 'シート画像をドラッグ&ドロップ、またはクリックして選択(複数可)',
    hint: `PNG/JPEG/WebP。6列×4行(24個)のスタンプが並んだシート画像を選んでください。最大${MAX_SHEETS}枚まで同時に読み込めます。`,
    multiple: true,
    onFiles: (files) => addSheetsFromFiles(files),
    onInvalidFile: (message) => showToast(message, 'error'),
  });

  const addMoreInput = h('input', {
    className: 'dropzone__input',
    attrs: { type: 'file', accept: 'image/*', multiple: 'multiple' },
  });
  addMoreInput.addEventListener('change', () => {
    addSheetsFromFiles(Array.from(addMoreInput.files ?? []));
    addMoreInput.value = '';
  });

  const panHint = h('p', {
    className: 'split-method-label',
    text: '操作: スペース+ドラッグ(またはホイールクリック+ドラッグ)で移動 / ホイールで拡大縮小 / ハンドルドラッグでリサイズ(Shiftで縦横比維持、Altで中心固定)',
  });

  const workspace = h('div', { className: 'split-layout' }, [
    h('div', { className: 'split-canvas-wrapper' }, [
      canvas,
      methodLabel,
      backgroundModeLabel,
      panHint,
      h('div', { className: 'toolbar' }, [
        zoomOutButton,
        zoomInButton,
        zoomResetButton,
        darkBgButton,
        darkenOutsideButton,
      ]),
    ]),
    h('div', { className: 'split-side-panel' }, [
      createSectionHeading('背景の扱い'),
      h('div', { className: 'toolbar' }, [colorModeButton, transparentModeButton]),
      createSectionHeading('検出パラメータ'),
      bgThreshold.element,
      alphaThresholdSlider.element,
      minArea.element,
      equalDivisionField,
      h('div', { className: 'toolbar' }, [redetectButton, eyedropperButton]),
      resetAllButton,
      h('div', { className: 'toolbar' }, [undoCellButton, redoCellButton]),
      createSectionHeading('選択中のセル'),
      selectionPanel,
      createSectionHeading('警告'),
      warningList,
      h('div', { className: 'toolbar' }, [confirmButton]),
    ]),
  ]);
  workspace.hidden = true;

  function openWithExisting(incoming: SheetStore, preferredActiveId: string | null = null): void {
    store = incoming;
    incoming.sheets.forEach((sheet) => {
      if (!uiStateBySheet.has(sheet.id)) {
        uiStateBySheet.set(sheet.id, { useEqualDivision: false, lastMethod: 'projection' });
      }
    });
    refreshSheetTabs();
    const target = (preferredActiveId && getSheet(store, preferredActiveId)) ?? store.sheets[0];
    if (target) {
      switchToSheet(target.id);
    } else {
      activeSheetId = null;
      workspace.hidden = true;
      emptyState.hidden = false;
    }
  }

  const element = h('div', { className: 'split-view' }, [
    sheetTabs.element,
    dropzone,
    emptyState,
    workspace,
  ]);

  window.addEventListener('keydown', (event) => {
    if (element.hidden || isEditableEventTarget(event.target)) {
      return;
    }
    const key = event.key.toLowerCase();
    const withModifier = event.ctrlKey || event.metaKey;
    if (!withModifier || (key !== 'z' && key !== 'y')) {
      return;
    }
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoCellEdit();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      redoCellEdit();
    }
  });

  return { element, openWithExisting };
}
