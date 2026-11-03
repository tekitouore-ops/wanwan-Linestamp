import { renderMainImage, renderTabImage } from '../export/coverImages';
import { computeStampWarnings, renderStamp } from '../export/renderStamp';
import {
  validateDimensions,
  validateEmptyCells,
  validateFileSize,
  validateMissingSourceSheet,
  validateOverflowingCells,
  type ValidationIssue,
} from '../export/validate';
import { buildFullZipFromBlobs, formatZipFileName } from '../export/zip';
import { h, isEditableEventTarget } from '../shared/dom';
import { downloadBlob, downloadTextFile, openFilePicker } from '../shared/file';
import { imageDataLikeToPngBlob, loadImageDataFromFile } from '../shared/imageData';
import {
  MAIN_IMAGE_FILE_NAME,
  MAIN_IMAGE_SIZE,
  STAMP_COUNT,
  STAMP_MAX_FILE_SIZE_BYTES,
  STAMP_MAX_HEIGHT,
  STAMP_MAX_WIDTH,
  TAB_IMAGE_FILE_NAME,
  TAB_IMAGE_SIZE,
  stampFileName,
} from '../shared/lineSpec';
import type { ImageDataLike, RGB } from '../shared/types';
import { showToast } from '../ui/toast';
import { createAdjustPanel } from './adjustPanel';
import { createBackgroundPicker } from './backgroundPicker';
import { createBulkSourceDialog, type BulkSourceMode } from './bulkSourceDialog';
import { createCompareDialog, type CompareOption } from './compareDialog';
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
  applyAdjustToAll,
  getResolvedStampAdjust,
  getSourceSheet,
  getStampFrame,
  isStampAdjusted,
  resetStampAdjust,
  setCoverIndex,
  setPreview,
  setSourceForAllStamps,
  setSourceForParity,
  setSourceForWarningStamps,
  setStampSource,
  updateGlobalSettings,
  updateStampAdjust,
  updateStampCrop,
} from './editorState';
import { createSheetAssignDialog } from './sheetAssignDialog';
import {
  countUnassignedSheets,
  matchSheetsByNameAndSize,
  remapProjectIds,
  type SheetAssignmentRow,
} from './sheetMatch';
import { addSheet, getSheetImage, type SheetStore } from './sheetStore';
import { createSourcePicker, type SourceOption } from './sourcePicker';
import { createStampCard, type StampCardHandle } from './stampCard';
import {
  DEFAULT_DETECTION_PARAMS,
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_PREVIEW_SETTINGS,
  createDefaultStampSetting,
  type CropAmount,
  type DetectionParams,
  type GlobalSettings,
  type PreviewSettings,
  type ProjectState,
  type Rect,
  type Sheet,
  type StampAdjustFields,
  type StampSetting,
} from './types';

const PREVIEW_STORAGE_KEY = 'wanwan-linestamp:split-preview-background:v1';
const RENDER_ALL_DEBOUNCE_MS = 200;
const FALLBACK_BACKGROUND_COLOR: RGB = { r: 255, g: 255, b: 255 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRect(value: unknown): Rect | null {
  if (!isRecord(value)) {
    return null;
  }
  const { x, y, width, height } = value;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null;
  }
  return { x, y, width, height };
}

function parseCrop(value: unknown): CropAmount | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { top, right, bottom, left } = value;
  if ([top, right, bottom, left].every((v) => typeof v === 'number')) {
    return {
      top: top as number,
      right: right as number,
      bottom: bottom as number,
      left: left as number,
    };
  }
  return undefined;
}

function parseCropBySheet(value: unknown): Record<string, CropAmount> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Record<string, CropAmount> = {};
  for (const [sheetId, raw] of Object.entries(value)) {
    const crop = parseCrop(raw);
    if (crop) {
      result[sheetId] = crop;
    }
  }
  return result;
}

function parseAdjustFields(value: unknown): Partial<StampAdjustFields> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Partial<StampAdjustFields> = {};
  if (typeof value.edgeFix === 'number') result.edgeFix = value.edgeFix;
  if (typeof value.outline === 'number') result.outline = value.outline;
  if (typeof value.scale === 'number') result.scale = value.scale;
  if (typeof value.offsetX === 'number') result.offsetX = value.offsetX;
  if (typeof value.offsetY === 'number') result.offsetY = value.offsetY;
  return result;
}

function parseGlobalSettings(value: unknown): GlobalSettings {
  if (!isRecord(value)) {
    return DEFAULT_GLOBAL_SETTINGS;
  }
  const g = DEFAULT_GLOBAL_SETTINGS;
  return {
    outputWidth: typeof value.outputWidth === 'number' ? value.outputWidth : g.outputWidth,
    outputHeight: typeof value.outputHeight === 'number' ? value.outputHeight : g.outputHeight,
    innerMargin: typeof value.innerMargin === 'number' ? value.innerMargin : g.innerMargin,
    defaultOutline:
      typeof value.defaultOutline === 'number' ? value.defaultOutline : g.defaultOutline,
    alphaThreshold:
      typeof value.alphaThreshold === 'number' ? value.alphaThreshold : g.alphaThreshold,
    featherPx: typeof value.featherPx === 'number' ? value.featherPx : g.featherPx,
    align: value.align === 'bottom' ? 'bottom' : 'center',
    allowUpscale: typeof value.allowUpscale === 'boolean' ? value.allowUpscale : g.allowUpscale,
  };
}

function parsePreview(value: unknown): PreviewSettings {
  if (!isRecord(value)) {
    return DEFAULT_PREVIEW_SETTINGS;
  }
  return {
    mode: value.mode === 'color' ? 'color' : 'checker',
    color: typeof value.color === 'string' ? value.color : DEFAULT_PREVIEW_SETTINGS.color,
  };
}

function parseDetectSettings(value: unknown): DetectionParams {
  const base: DetectionParams = { ...DEFAULT_DETECTION_PARAMS, cols: 6, rows: 4 };
  if (!isRecord(value)) {
    return base;
  }
  return {
    ...base,
    backgroundThreshold:
      typeof value.backgroundThreshold === 'number'
        ? value.backgroundThreshold
        : base.backgroundThreshold,
    minAreaRatio: typeof value.minAreaRatio === 'number' ? value.minAreaRatio : base.minAreaRatio,
    cols: typeof value.cols === 'number' ? value.cols : base.cols,
    rows: typeof value.rows === 'number' ? value.rows : base.rows,
    backgroundMode: value.backgroundMode === 'transparent' ? 'transparent' : 'color',
    alphaThreshold:
      typeof value.alphaThreshold === 'number' ? value.alphaThreshold : base.alphaThreshold,
  };
}

function parseSheetMeta(value: unknown): Sheet | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null;
  }
  const framesRaw = Array.isArray(value.frames) ? value.frames : [];
  const frames = framesRaw.map(parseRect).filter((r): r is Rect => r !== null);
  if (frames.length !== STAMP_COUNT) {
    return null;
  }
  const warningsRaw = Array.isArray(value.frameWarnings) ? value.frameWarnings : [];
  const frameWarnings = frames.map((_, i) =>
    Array.isArray(warningsRaw[i]) ? (warningsRaw[i] as Sheet['frameWarnings'][number]) : [],
  );
  return {
    id: value.id,
    name: value.name,
    width: typeof value.width === 'number' ? value.width : 0,
    height: typeof value.height === 'number' ? value.height : 0,
    detectSettings: parseDetectSettings(value.detectSettings),
    frames,
    frameWarnings,
  };
}

/**
 * 設定JSON(version 2)を読み込む。シートの画像データ本体は含まれないため、呼び出し側で
 * 「現在読み込み済みのシート(名前が一致するもの)」とだけ突き合わせて使う(B-6参照。
 * ファイル名・サイズでの自動対応づけ+手動割り当てUIは今回のスコープでは簡易化している。
 * 詳細はdocs/decisions.md参照)。
 */
function parseProjectStateV2(value: unknown): ProjectState | null {
  if (!isRecord(value) || !Array.isArray(value.sheets) || !Array.isArray(value.stamps)) {
    return null;
  }
  const sheets = value.sheets.map(parseSheetMeta).filter((s): s is Sheet => s !== null);
  if (sheets.length === 0) {
    return null;
  }
  const stampsRaw = value.stamps;
  const stamps: StampSetting[] = Array.from({ length: STAMP_COUNT }, (_, i) => {
    const raw = stampsRaw[i];
    if (!isRecord(raw) || typeof raw.sourceSheetId !== 'string') {
      return createDefaultStampSetting(sheets[0]?.id ?? '');
    }
    return {
      sourceSheetId: raw.sourceSheetId,
      adjust: parseAdjustFields(raw.adjust),
      cropBySheet: parseCropBySheet(raw.cropBySheet),
    };
  });

  return {
    version: 2,
    sheets,
    stamps,
    globalSettings: parseGlobalSettings(value.globalSettings),
    coverIndex:
      typeof value.coverIndex === 'number' && value.coverIndex < STAMP_COUNT ? value.coverIndex : 0,
    preview: parsePreview(value.preview),
  };
}

/** v1(単一シート)の設定JSONを、シート1枚ぶんのversion 2構造に変換する。画像は含まれないため幅・高さは0とする。 */
function migrateProjectStateV1(value: Record<string, unknown>): ProjectState | null {
  if (!Array.isArray(value.frames)) {
    return null;
  }
  const frames = value.frames.map(parseRect).filter((r): r is Rect => r !== null);
  if (frames.length !== STAMP_COUNT) {
    return null;
  }
  const sheetId = 'legacy-sheet';
  const sheet: Sheet = {
    id: sheetId,
    name: typeof value.sourceName === 'string' && value.sourceName ? value.sourceName : 'シート1',
    width: 0,
    height: 0,
    detectSettings: { ...DEFAULT_DETECTION_PARAMS, cols: 6, rows: 4 },
    frames,
    frameWarnings: frames.map(() => []),
  };
  const stampsRaw = Array.isArray(value.stamps) ? value.stamps : [];
  const stamps: StampSetting[] = frames.map((_, i) => {
    const legacyAdjust = stampsRaw[i];
    const crop = isRecord(legacyAdjust) ? parseCrop(legacyAdjust.crop) : undefined;
    const cropBySheet: Record<string, CropAmount> = {};
    if (crop) {
      cropBySheet[sheetId] = crop;
    }
    return {
      sourceSheetId: sheetId,
      adjust: parseAdjustFields(legacyAdjust),
      cropBySheet,
    };
  });

  return {
    version: 2,
    sheets: [sheet],
    stamps,
    globalSettings: parseGlobalSettings(value.globalSettings),
    coverIndex:
      typeof value.coverIndex === 'number' && value.coverIndex < frames.length
        ? value.coverIndex
        : 0,
    preview: parsePreview(value.preview),
  };
}

function parseProjectState(value: unknown): ProjectState | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.version === 2) {
    return parseProjectStateV2(value);
  }
  return migrateProjectStateV1(value);
}

function loadStoredPreviewPreference(): PreviewSettings {
  try {
    const raw = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
    return raw ? parsePreview(JSON.parse(raw)) : DEFAULT_PREVIEW_SETTINGS;
  } catch {
    return DEFAULT_PREVIEW_SETTINGS;
  }
}

function savePreviewPreference(preview: PreviewSettings): void {
  try {
    window.localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(preview));
  } catch {
    // 保存できなくても補助機能のため無視する。
  }
}

function hasOpaquePixels(image: ImageDataLike): boolean {
  for (let i = 3; i < image.data.length; i += 4) {
    if ((image.data[i] ?? 0) > 0) {
      return true;
    }
  }
  return false;
}

function formatTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
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

export interface PreviewViewHandle {
  element: HTMLElement;
  setProject: (store: SheetStore, project: ProjectState) => void;
}

/**
 * タブ②ステップB(カードプレビュー+左の調整パネル)の画面を構築する。
 * `onFixFrames` は「枠を修正」が押されたときに、現在の `SheetStore`・`ProjectState` とともに呼ばれる
 * (このビュー内で行った調整・採用元変更はこのビューの外からは見えないため、戻すタイミングで渡す)。
 */
export function createPreviewView(
  onFixFrames: (store: SheetStore, project: ProjectState) => void,
): PreviewViewHandle {
  let store: SheetStore = { sheets: [], images: new Map() };
  let project: ProjectState | null = null;
  let selectedIndex = 0;
  /**
   * Undo/Redo履歴(修正指示書 項目4)。`ProjectState`のスナップショット方式で、画像データは
   * 含まない。シート一式が変わる操作(`setProject`・設定JSON読込)では作り直す(履歴を引き継がない)。
   */
  let history: History<ProjectState> | null = null;

  const cards: StampCardHandle[] = [];
  const cardsGrid = h('div', { className: 'preview-grid preview-grid--checker' });

  function sheetLabel(sheetId: string): string | null {
    if (!project || project.sheets.length <= 1) {
      return null;
    }
    const i = project.sheets.findIndex((sheet) => sheet.id === sheetId);
    return i === -1 ? null : `S${i + 1}`;
  }

  function refreshSourcePicker(index: number): void {
    if (!project) {
      return;
    }
    const setting = project.stamps[index];
    const options: SourceOption[] = project.sheets.map((sheet) => ({
      sheet,
      image: getSheetImage(store, sheet.id),
      warnings: sheet.frameWarnings[index] ?? [],
    }));
    sourcePicker.setOptions(index, options, setting?.sourceSheetId ?? '');
  }

  function selectCardAt(index: number): void {
    if (!project) {
      return;
    }
    selectedIndex = index;
    cards.forEach((card, i) => card.setSelected(i === index));
    const frame = getStampFrame(project, index);
    if (!frame) {
      adjustPanel.showEmpty();
      return;
    }
    refreshSourcePicker(index);
    adjustPanel.showForStamp({
      index,
      frame,
      resolved: getResolvedStampAdjust(project, index),
      isCover: index === project.coverIndex,
      sourcePickerElement: sourcePicker.element,
      hasMultipleSheets: project.sheets.length > 1,
    });
  }

  for (let i = 0; i < STAMP_COUNT; i += 1) {
    const index = i;
    const card = createStampCard(index, (selected) => selectCardAt(selected));
    cards.push(card);
    cardsGrid.append(card.element);
  }

  function refreshCoverPreview(): void {
    if (!project) {
      return;
    }
    const sheet = getSourceSheet(project, project.coverIndex);
    const image = sheet ? getSheetImage(store, sheet.id) : undefined;
    const frame = sheet?.frames[project.coverIndex];
    if (!sheet || !image || !frame) {
      return;
    }
    const resolved = getResolvedStampAdjust(project, project.coverIndex);
    const backgroundColor = sheet.detectSettings.backgroundColor ?? FALLBACK_BACKGROUND_COLOR;
    try {
      drawToCanvas(
        mainPreviewCanvas,
        renderMainImage(
          image,
          frame,
          backgroundColor,
          project.globalSettings,
          resolved,
          sheet.detectSettings.backgroundMode,
        ),
      );
      drawToCanvas(
        tabPreviewCanvas,
        renderTabImage(
          image,
          frame,
          backgroundColor,
          project.globalSettings,
          resolved,
          sheet.detectSettings.backgroundMode,
        ),
      );
    } catch {
      // 表紙プレビューの生成に失敗しても、書き出し時に改めてエラーを出すのでここでは無視する。
    }
  }

  function renderCard(index: number): void {
    if (!project) {
      return;
    }
    const card = cards[index];
    const sheet = getSourceSheet(project, index);
    const image = sheet ? getSheetImage(store, sheet.id) : undefined;
    const frame = sheet?.frames[index];
    if (!card) {
      return;
    }
    card.setSourceBadge(sheet ? sheetLabel(sheet.id) : null);

    if (!sheet || !image || !frame) {
      card.setWarnings(['採用元のシートが見つかりません']);
      return;
    }

    const resolved = getResolvedStampAdjust(project, index);
    const backgroundColor = sheet.detectSettings.backgroundColor ?? FALLBACK_BACKGROUND_COLOR;
    let rendered: ImageDataLike;
    try {
      rendered = renderStamp(
        image,
        frame,
        backgroundColor,
        project.globalSettings,
        resolved,
        sheet.detectSettings.backgroundMode,
      );
    } catch {
      return;
    }
    card.setImage(rendered);
    card.setCover(index === project.coverIndex);
    card.setAdjusted(isStampAdjusted(project, index));

    const labels: string[] = [];
    if (!hasOpaquePixels(rendered)) {
      labels.push('空(内容なし)');
    }
    const layoutWarnings = computeStampWarnings(frame, resolved, project.globalSettings);
    if (layoutWarnings.isUpscaled) {
      labels.push('解像度不足の可能性');
    }
    if (layoutWarnings.isOverflowing) {
      labels.push('配置がキャンバスからはみ出し');
    }
    card.setWarnings(labels);

    if (index === project.coverIndex) {
      refreshCoverPreview();
    }
  }

  function renderAllCards(): void {
    if (!project) {
      return;
    }
    project.stamps.forEach((_, index) => renderCard(index));
  }

  let renderAllTimer: number | undefined;
  function scheduleRenderAll(): void {
    if (renderAllTimer !== undefined) {
      window.clearTimeout(renderAllTimer);
    }
    renderAllTimer = window.setTimeout(() => renderAllCards(), RENDER_ALL_DEBOUNCE_MS);
  }

  function applyPreviewBackground(preview: PreviewSettings): void {
    if (preview.mode === 'checker') {
      cardsGrid.classList.add('preview-grid--checker');
      cardsGrid.style.backgroundColor = '';
    } else {
      cardsGrid.classList.remove('preview-grid--checker');
      cardsGrid.style.backgroundColor = preview.color;
    }
  }

  function refreshStampPanels(index: number): void {
    renderCard(index);
    if (selectedIndex === index) {
      selectCardAt(index);
    }
  }

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

  function updateHistoryButtons(): void {
    undoButton.toggleAttribute('disabled', !(history && canUndo(history)));
    redoButton.toggleAttribute('disabled', !(history && canRedo(history)));
  }
  updateHistoryButtons();

  /** 現在の`project`を1手として履歴へコミットする(スライダーはドラッグ終了時、ボタンは押下時に呼ぶ)。 */
  function commitHistory(): void {
    if (!project || !history) {
      return;
    }
    history = pushHistory(history, project);
    updateHistoryButtons();
  }

  /** シート一式が変わる操作(枠確定・設定JSON読込)のあと、履歴を作り直す(過去は引き継がない)。 */
  function resetHistory(): void {
    if (project) {
      history = createHistory(project);
    }
    updateHistoryButtons();
  }

  function restoreProjectFromHistory(next: ProjectState): void {
    project = next;
    adjustPanel.setGlobalSettings(project.globalSettings);
    backgroundPicker.setValue(project.preview);
    applyPreviewBackground(project.preview);
    renderAllCards();
    selectCardAt(Math.min(selectedIndex, STAMP_COUNT - 1));
  }

  function handleUndo(): void {
    if (!history || !canUndo(history)) {
      return;
    }
    history = undoHistory(history);
    restoreProjectFromHistory(history.present);
    updateHistoryButtons();
  }

  function handleRedo(): void {
    if (!history || !canRedo(history)) {
      return;
    }
    history = redoHistory(history);
    restoreProjectFromHistory(history.present);
    updateHistoryButtons();
  }

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
      handleUndo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      handleRedo();
    }
  });

  const sourcePicker = createSourcePicker({
    onSelect: (sheetId) => {
      if (!project) return;
      project = setStampSource(project, selectedIndex, sheetId);
      refreshStampPanels(selectedIndex);
      commitHistory();
    },
  });

  const compareDialog = createCompareDialog({
    onSelect: (sheetId) => {
      if (!project) return;
      project = setStampSource(project, selectedIndex, sheetId);
      refreshStampPanels(selectedIndex);
      commitHistory();
    },
  });

  const bulkSourceDialog = createBulkSourceDialog({
    onApply: (sheetId, mode) => {
      if (!project) return;
      const current = project;
      const modeMap: Record<BulkSourceMode, () => ProjectState> = {
        all: () => setSourceForAllStamps(current, sheetId),
        odd: () => setSourceForParity(current, sheetId, 'odd'),
        even: () => setSourceForParity(current, sheetId, 'even'),
        warning: () => setSourceForWarningStamps(current, sheetId),
      };
      project = modeMap[mode]();
      renderAllCards();
      refreshStampPanels(selectedIndex);
      showToast('採用元をまとめて設定しました。');
      commitHistory();
    },
  });

  const adjustPanel = createAdjustPanel({
    onAdjustChange: (index, patch) => {
      if (!project) return;
      project = updateStampAdjust(project, index, patch);
      renderCard(index);
    },
    onCropChange: (index, crop) => {
      if (!project) return;
      project = updateStampCrop(project, index, crop);
      renderCard(index);
    },
    onCommit: () => commitHistory(),
    onResetStamp: (index) => {
      if (!project) return;
      project = resetStampAdjust(project, index);
      refreshStampPanels(index);
      commitHistory();
    },
    onApplyToAll: (index, fields) => {
      if (!project) return;
      project = applyAdjustToAll(project, index, fields);
      renderAllCards();
      showToast('他の23枚に適用しました。');
      commitHistory();
    },
    onSetCover: (index) => {
      if (!project) return;
      const previousCover = project.coverIndex;
      project = setCoverIndex(project, index);
      cards[previousCover]?.setCover(false);
      cards[index]?.setCover(true);
      refreshCoverPreview();
      selectCardAt(index);
      commitHistory();
    },
    onGlobalSettingsChange: (patch) => {
      if (!project) return;
      project = updateGlobalSettings(project, patch);
      scheduleRenderAll();
    },
    onCompareSources: (index) => {
      if (!project) return;
      const current = project;
      const setting = current.stamps[index];
      const options: CompareOption[] = current.sheets.map((sheet) => {
        const image = getSheetImage(store, sheet.id);
        const frame = sheet.frames[index];
        if (!image || !frame) {
          return { sheet, rendered: null };
        }
        const candidateSetting: StampSetting = {
          sourceSheetId: sheet.id,
          adjust: setting?.adjust ?? {},
          cropBySheet: setting?.cropBySheet ?? {},
        };
        const resolved = getResolvedStampAdjust(
          {
            ...current,
            stamps: current.stamps.map((s, i) => (i === index ? candidateSetting : s)),
          },
          index,
        );
        const backgroundColor = sheet.detectSettings.backgroundColor ?? FALLBACK_BACKGROUND_COLOR;
        try {
          return {
            sheet,
            rendered: renderStamp(
              image,
              frame,
              backgroundColor,
              current.globalSettings,
              resolved,
              sheet.detectSettings.backgroundMode,
            ),
          };
        } catch {
          return { sheet, rendered: null };
        }
      });
      compareDialog.open(
        `${stampFileName(index + 1)} の採用元を比較`,
        options,
        setting?.sourceSheetId ?? '',
      );
    },
    onBulkSource: () => {
      if (!project) return;
      bulkSourceDialog.open(project.sheets);
    },
  });

  const backgroundPicker = createBackgroundPicker(loadStoredPreviewPreference(), (value) => {
    if (!project) {
      return;
    }
    project = setPreview(project, value);
    applyPreviewBackground(value);
    savePreviewPreference(value);
  });

  const fixFramesButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '枠を修正',
    on: {
      click: () => {
        if (project) {
          onFixFrames(store, project);
        }
      },
    },
  });

  const mainPreviewCanvas = h('canvas', {
    className: 'cover-preview__canvas cover-preview__canvas--main',
  });
  const tabPreviewCanvas = h('canvas', {
    className: 'cover-preview__canvas cover-preview__canvas--tab',
  });
  const coverPreviewGroup = h('div', { className: 'cover-preview' }, [
    h('div', { className: 'cover-preview__item' }, [
      mainPreviewCanvas,
      h('span', { text: 'メイン画像' }),
    ]),
    h('div', { className: 'cover-preview__item' }, [
      tabPreviewCanvas,
      h('span', { text: 'タブ画像' }),
    ]),
  ]);

  const includeTabImageCheckbox = h('input', { attrs: { type: 'checkbox' } });
  includeTabImageCheckbox.checked = true;
  const includeTabImageField = h('div', { className: 'field field--checkbox' }, [
    h('label', { className: 'checkbox-field' }, [includeTabImageCheckbox, ' タブ画像も出力']),
  ]);

  const includeSourcesTextCheckbox = h('input', { attrs: { type: 'checkbox' } });
  const includeSourcesTextField = h('div', { className: 'field field--checkbox' }, [
    h('label', { className: 'checkbox-field' }, [
      includeSourcesTextCheckbox,
      ' 採用元一覧(sources.txt)も同梱',
    ]),
  ]);

  const downloadSelectedButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '選択中の1枚をPNG保存',
    on: {
      click: () => {
        const image = cards[selectedIndex]?.getLastImage();
        if (!image) {
          showToast('先にプレビューを表示してください。', 'error');
          return;
        }
        void imageDataLikeToPngBlob(image).then((blob) =>
          downloadBlob(blob, stampFileName(selectedIndex + 1)),
        );
      },
    },
  });

  const exportIssueList = h('ul', { className: 'warning-list' });
  function renderExportIssues(issues: ValidationIssue[]): void {
    exportIssueList.replaceChildren();
    if (issues.length === 0) {
      exportIssueList.append(
        h('li', { className: 'warning-list__empty', text: '問題は見つかりませんでした。' }),
      );
      return;
    }
    issues.forEach((issue) => exportIssueList.append(h('li', { text: issue.message })));
  }

  function buildSourcesText(currentProject: ProjectState): string {
    const lines = currentProject.stamps.map((setting, index) => {
      const sheetIndex = currentProject.sheets.findIndex(
        (sheet) => sheet.id === setting.sourceSheetId,
      );
      const sheet = currentProject.sheets[sheetIndex];
      return `${stampFileName(index + 1)}\t${sheet ? `S${sheetIndex + 1} ${sheet.name}` : '(不明)'}`;
    });
    return ['ファイル\t採用元シート', ...lines].join('\n');
  }

  const exportButton = h('button', {
    className: 'button button--primary',
    attrs: { type: 'button' },
    text: 'ZIPで書き出し',
    on: { click: () => void handleExport() },
  });

  async function handleExport(): Promise<void> {
    if (!project || project.sheets.length === 0) {
      showToast('先にシート画像を読み込んでください。', 'error');
      return;
    }
    const currentProject = project;

    exportButton.setAttribute('disabled', 'true');
    try {
      const emptyIndexes: number[] = [];
      const overflowingIndexes: number[] = [];
      const missingSourceIndexes: number[] = [];
      const images: ImageDataLike[] = [];
      const dimensionIssues: ValidationIssue[] = [];

      currentProject.stamps.forEach((setting, index) => {
        const sheet = currentProject.sheets.find((s) => s.id === setting.sourceSheetId);
        const image = sheet ? getSheetImage(store, sheet.id) : undefined;
        const frame = sheet?.frames[index];
        if (!sheet || !image || !frame) {
          missingSourceIndexes.push(index);
          images[index] = { width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4) };
          emptyIndexes.push(index);
          return;
        }
        const resolved = getResolvedStampAdjust(currentProject, index);
        const backgroundColor = sheet.detectSettings.backgroundColor ?? FALLBACK_BACKGROUND_COLOR;
        const rendered = renderStamp(
          image,
          frame,
          backgroundColor,
          currentProject.globalSettings,
          resolved,
          sheet.detectSettings.backgroundMode,
        );
        images[index] = rendered;
        if (!hasOpaquePixels(rendered)) {
          emptyIndexes.push(index);
        }
        if (computeStampWarnings(frame, resolved, currentProject.globalSettings).isOverflowing) {
          overflowingIndexes.push(index);
        }
        dimensionIssues.push(
          ...validateDimensions(
            `No.${index + 1}`,
            rendered.width,
            rendered.height,
            STAMP_MAX_WIDTH,
            STAMP_MAX_HEIGHT,
            index,
          ),
        );
      });

      const blobs: Blob[] = [];
      for (const image of images) {
        blobs.push(await imageDataLikeToPngBlob(image));
      }
      const sizeIssues = blobs.flatMap((blob, index) =>
        validateFileSize(`No.${index + 1}`, blob.size, STAMP_MAX_FILE_SIZE_BYTES, index),
      );

      const coverSheet = getSourceSheet(currentProject, currentProject.coverIndex);
      const coverImage = coverSheet ? getSheetImage(store, coverSheet.id) : undefined;
      const coverFrame = coverSheet?.frames[currentProject.coverIndex];
      const coverResolved = getResolvedStampAdjust(currentProject, currentProject.coverIndex);
      const extraFiles: Record<string, Blob> = {};
      let coverIssues: ValidationIssue[] = [];

      if (coverSheet && coverImage && coverFrame) {
        const backgroundColor =
          coverSheet.detectSettings.backgroundColor ?? FALLBACK_BACKGROUND_COLOR;
        const mainImage = renderMainImage(
          coverImage,
          coverFrame,
          backgroundColor,
          currentProject.globalSettings,
          coverResolved,
          coverSheet.detectSettings.backgroundMode,
        );
        const mainBlob = await imageDataLikeToPngBlob(mainImage);
        extraFiles[MAIN_IMAGE_FILE_NAME] = mainBlob;
        coverIssues = [
          ...coverIssues,
          ...validateDimensions(
            'メイン画像',
            mainImage.width,
            mainImage.height,
            MAIN_IMAGE_SIZE.width,
            MAIN_IMAGE_SIZE.height,
          ),
          ...validateFileSize('メイン画像', mainBlob.size, STAMP_MAX_FILE_SIZE_BYTES),
        ];

        if (includeTabImageCheckbox.checked) {
          const tabImage = renderTabImage(
            coverImage,
            coverFrame,
            backgroundColor,
            currentProject.globalSettings,
            coverResolved,
            coverSheet.detectSettings.backgroundMode,
          );
          const tabBlob = await imageDataLikeToPngBlob(tabImage);
          extraFiles[TAB_IMAGE_FILE_NAME] = tabBlob;
          coverIssues = [
            ...coverIssues,
            ...validateDimensions(
              'タブ画像',
              tabImage.width,
              tabImage.height,
              TAB_IMAGE_SIZE.width,
              TAB_IMAGE_SIZE.height,
            ),
            ...validateFileSize('タブ画像', tabBlob.size, STAMP_MAX_FILE_SIZE_BYTES),
          ];
        }
      }

      if (includeSourcesTextCheckbox.checked) {
        extraFiles['sources.txt'] = new Blob([buildSourcesText(currentProject)], {
          type: 'text/plain;charset=utf-8',
        });
      }

      const allIssues = [
        ...validateMissingSourceSheet(missingSourceIndexes),
        ...validateEmptyCells(emptyIndexes.filter((i) => !missingSourceIndexes.includes(i))),
        ...validateOverflowingCells(overflowingIndexes),
        ...dimensionIssues,
        ...sizeIssues,
        ...coverIssues,
      ];
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

      const zipBlob = await buildFullZipFromBlobs(blobs, extraFiles);
      downloadBlob(zipBlob, formatZipFileName(new Date()));
      showToast('ZIPを書き出しました。');
    } catch {
      showToast('書き出しに失敗しました。もう一度お試しください。', 'error');
    } finally {
      exportButton.removeAttribute('disabled');
    }
  }

  const saveSettingsButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '検出枠・設定をJSONで保存',
    on: {
      click: () => {
        if (!project) {
          showToast('先にシート画像を読み込んでください。', 'error');
          return;
        }
        downloadTextFile(
          `wanwan-linestamp-split-settings_${formatTimestamp(new Date())}.json`,
          JSON.stringify(project, null, 2),
          'application/json',
        );
      },
    },
  });

  /**
   * 保存シート→現在のシートidの対応づけ(`idMap`、「割り当てない」はエントリなし)を使って、
   * 読み込んだProjectStateのidを現在のセッションのものへ付け替えて(`remapProjectIds`)反映する。
   */
  function finalizeSettingsLoad(parsed: ProjectState, idMap: Map<string, string>): void {
    project = remapProjectIds(parsed, idMap, store.sheets);
    adjustPanel.setGlobalSettings(project.globalSettings);
    backgroundPicker.setValue(project.preview);
    applyPreviewBackground(project.preview);
    renderAllCards();
    selectCardAt(Math.min(selectedIndex, STAMP_COUNT - 1));
    resetHistory();

    const unassignedCount = countUnassignedSheets(parsed, idMap);
    showToast(
      unassignedCount > 0
        ? `検出枠・設定を読み込みました(画像が割り当てられなかったシートが${unassignedCount}件あります)。`
        : '検出枠・設定を読み込みました。',
    );
  }

  let pendingParsedProject: ProjectState | null = null;
  /** ダイアログに表示中の行に対応する、保存シートのid一覧(「画像を追加で読み込む」後の再提案に使う)。 */
  let pendingRowSavedIds: string[] = [];

  const sheetAssignDialog = createSheetAssignDialog({
    onApply: (assignments) => {
      if (!pendingParsedProject) {
        return;
      }
      const idMap = new Map<string, string>();
      // まず自動対応づけできた分(名前・サイズ一致)を反映する。
      const autoMatch = matchSheetsByNameAndSize(pendingParsedProject.sheets, store.sheets);
      Object.entries(autoMatch.idMap).forEach(([savedId, currentId]) =>
        idMap.set(savedId, currentId),
      );
      // ダイアログでの手動割り当てを上書きする(「割り当てない」はエントリを作らない)。
      Object.entries(assignments).forEach(([savedId, currentId]) => {
        if (currentId) {
          idMap.set(savedId, currentId);
        } else {
          idMap.delete(savedId);
        }
      });
      finalizeSettingsLoad(pendingParsedProject, idMap);
      pendingParsedProject = null;
      pendingRowSavedIds = [];
    },
    onAddMoreImages: (files) => {
      void (async () => {
        for (const file of files) {
          try {
            const image = await loadImageDataFromFile(file);
            const added = addSheet(store, file.name, image, {
              ...DEFAULT_DETECTION_PARAMS,
              cols: 6,
              rows: 4,
            });
            store = added.store;
          } catch {
            showToast(`${file.name} の読み込みに失敗しました。`, 'error');
          }
        }
        const currentParsed = pendingParsedProject;
        if (currentParsed) {
          // 表示中の行(保存シート)それぞれについて、画像追加後の状況で候補を再計算する。
          // 名前・サイズの両方が一致するようになった行は、その現在シートを既定の選択にする。
          const fullMatch = matchSheetsByNameAndSize(currentParsed.sheets, store.sheets);
          const updatedRows = pendingRowSavedIds.flatMap((savedId): SheetAssignmentRow[] => {
            const savedSheet = currentParsed.sheets.find((sheet) => sheet.id === savedId);
            if (!savedSheet) {
              return [];
            }
            const exactMatchId = fullMatch.idMap[savedId];
            if (exactMatchId) {
              return [{ savedSheet, suggestedSheetId: exactMatchId, sizeMismatch: false }];
            }
            const stillPending = fullMatch.needsAssignment.find(
              (row) => row.savedSheet.id === savedId,
            );
            return [
              stillPending ?? { savedSheet, suggestedSheetId: undefined, sizeMismatch: false },
            ];
          });
          sheetAssignDialog.refreshCandidates(updatedRows, store.sheets);
        }
      })();
    },
  });

  const loadSettingsButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '検出枠・設定をJSONで読み込み',
    on: {
      click: () => {
        if (!project) {
          showToast('先にシート画像を読み込んでください。', 'error');
          return;
        }
        void openFilePicker('application/json').then(async (file) => {
          if (!file) {
            return;
          }
          try {
            const text = await file.text();
            const parsed = parseProjectState(JSON.parse(text));
            if (!parsed) {
              showToast(
                '設定ファイルの形式が正しくありません(24枚ぶんの設定が必要です)。',
                'error',
              );
              return;
            }

            const match = matchSheetsByNameAndSize(parsed.sheets, store.sheets);
            if (match.needsAssignment.length === 0) {
              finalizeSettingsLoad(parsed, new Map(Object.entries(match.idMap)));
              return;
            }
            pendingParsedProject = parsed;
            pendingRowSavedIds = match.needsAssignment.map((row) => row.savedSheet.id);
            sheetAssignDialog.open(match.needsAssignment, store.sheets);
          } catch {
            showToast('設定ファイルの読み込みに失敗しました。', 'error');
          }
        });
      },
    },
  });

  function setProject(nextStore: SheetStore, newProject: ProjectState): void {
    const isNewSheetSet =
      project === null ||
      project.sheets.map((s) => s.id).join(',') !== newProject.sheets.map((s) => s.id).join(',');
    const effectiveProject = isNewSheetSet
      ? setPreview(newProject, loadStoredPreviewPreference())
      : newProject;

    store = nextStore;
    project = effectiveProject;

    adjustPanel.setGlobalSettings(project.globalSettings);
    backgroundPicker.setValue(project.preview);
    applyPreviewBackground(project.preview);
    renderAllCards();
    selectCardAt(isNewSheetSet ? 0 : Math.min(selectedIndex, STAMP_COUNT - 1));
    resetHistory();
  }

  const topBar = h('div', { className: 'preview-topbar' }, [
    h('div', { className: 'toolbar' }, [fixFramesButton, undoButton, redoButton]),
    backgroundPicker.element,
    coverPreviewGroup,
    includeTabImageField,
    includeSourcesTextField,
    h('div', { className: 'toolbar' }, [
      downloadSelectedButton,
      saveSettingsButton,
      loadSettingsButton,
      exportButton,
    ]),
  ]);

  const element = h('div', { className: 'preview-view' }, [
    topBar,
    h('div', { className: 'preview-main' }, [adjustPanel.element, cardsGrid]),
    exportIssueList,
  ]);

  return { element, setProject };
}
