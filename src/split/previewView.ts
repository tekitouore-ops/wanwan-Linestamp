import { renderMainImage, renderTabImage } from '../export/coverImages';
import { computeStampWarnings, renderStamp } from '../export/renderStamp';
import {
  validateDimensions,
  validateEmptyCells,
  validateFileSize,
  validateOverflowingCells,
  type ValidationIssue,
} from '../export/validate';
import { buildFullZipFromBlobs, formatZipFileName } from '../export/zip';
import { h } from '../shared/dom';
import { downloadBlob, downloadTextFile, openFilePicker } from '../shared/file';
import { imageDataLikeToPngBlob } from '../shared/imageData';
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
import {
  applyAdjustToAll,
  getResolvedStampAdjust,
  isStampAdjusted,
  resetStampAdjust,
  setCoverIndex,
  setPreview,
  updateGlobalSettings,
  updateStampAdjust,
} from './editorState';
import { createStampCard, type StampCardHandle } from './stampCard';
import {
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_PREVIEW_SETTINGS,
  type CropAmount,
  type GlobalSettings,
  type PreviewSettings,
  type ProjectState,
  type Rect,
  type StampAdjust,
} from './types';

const PREVIEW_STORAGE_KEY = 'wanwan-linestamp:split-preview-background:v1';
const RENDER_ALL_DEBOUNCE_MS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRect(value: unknown): Rect | null {
  if (!isRecord(value)) {
    return null;
  }
  const { x, y, width, height } = value;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
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
    return { top: top as number, right: right as number, bottom: bottom as number, left: left as number };
  }
  return undefined;
}

function parseStampAdjust(value: unknown): Partial<StampAdjust> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Partial<StampAdjust> = {};
  if (typeof value.edgeFix === 'number') result.edgeFix = value.edgeFix;
  if (typeof value.outline === 'number') result.outline = value.outline;
  const crop = parseCrop(value.crop);
  if (crop) result.crop = crop;
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
    defaultOutline: typeof value.defaultOutline === 'number' ? value.defaultOutline : g.defaultOutline,
    alphaThreshold: typeof value.alphaThreshold === 'number' ? value.alphaThreshold : g.alphaThreshold,
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

function parseProjectState(value: unknown): ProjectState | null {
  if (!isRecord(value) || !Array.isArray(value.frames)) {
    return null;
  }
  const frames = value.frames.map(parseRect).filter((r): r is Rect => r !== null);
  if (frames.length !== STAMP_COUNT) {
    return null;
  }
  const stampsRaw = Array.isArray(value.stamps) ? value.stamps : [];
  const stamps = frames.map((_, i) => parseStampAdjust(stampsRaw[i]));
  return {
    version: 1,
    sourceName: typeof value.sourceName === 'string' ? value.sourceName : '',
    frames,
    globalSettings: parseGlobalSettings(value.globalSettings),
    stamps,
    coverIndex: typeof value.coverIndex === 'number' && value.coverIndex < frames.length ? value.coverIndex : 0,
    preview: parsePreview(value.preview),
  };
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
    ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  }
}

export interface PreviewViewHandle {
  element: HTMLElement;
  setProject: (image: ImageDataLike, backgroundColor: RGB, project: ProjectState) => void;
}

/**
 * タブ②ステップB(カードプレビュー+左の調整パネル)の画面を構築する。
 * `onFixFrames` は「枠を修正」が押されたときに、現在の調整内容を含む`ProjectState`とともに呼ばれる
 * (このビュー内で行った調整はこのビューの外からは見えないため、戻すタイミングで渡す)。
 */
export function createPreviewView(onFixFrames: (project: ProjectState) => void): PreviewViewHandle {
  let originalImage: ImageDataLike | null = null;
  let backgroundColor: RGB = { r: 255, g: 255, b: 255 };
  let project: ProjectState | null = null;
  let selectedIndex = 0;

  const cards: StampCardHandle[] = [];
  const cardsGrid = h('div', { className: 'preview-grid preview-grid--checker' });

  function selectCardAt(index: number): void {
    if (!project) {
      return;
    }
    selectedIndex = index;
    cards.forEach((card, i) => card.setSelected(i === index));
    const frame = project.frames[index];
    if (!frame) {
      return;
    }
    adjustPanel.showForStamp({
      index,
      frame,
      resolved: getResolvedStampAdjust(project, index),
      isCover: index === project.coverIndex,
    });
  }

  for (let i = 0; i < STAMP_COUNT; i += 1) {
    const index = i;
    const card = createStampCard(index, (selected) => selectCardAt(selected));
    cards.push(card);
    cardsGrid.append(card.element);
  }

  function refreshCoverPreview(): void {
    if (!project || !originalImage) {
      return;
    }
    const frame = project.frames[project.coverIndex];
    if (!frame) {
      return;
    }
    const resolved = getResolvedStampAdjust(project, project.coverIndex);
    try {
      drawToCanvas(mainPreviewCanvas, renderMainImage(originalImage, frame, backgroundColor, project.globalSettings, resolved));
      drawToCanvas(tabPreviewCanvas, renderTabImage(originalImage, frame, backgroundColor, project.globalSettings, resolved));
    } catch {
      // 表紙プレビューの生成に失敗しても、書き出し時に改めてエラーを出すのでここでは無視する。
    }
  }

  function renderCard(index: number): void {
    if (!project || !originalImage) {
      return;
    }
    const card = cards[index];
    const frame = project.frames[index];
    if (!card || !frame) {
      return;
    }
    const resolved = getResolvedStampAdjust(project, index);
    let rendered: ImageDataLike;
    try {
      rendered = renderStamp(originalImage, frame, backgroundColor, project.globalSettings, resolved);
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
    project.frames.forEach((_, index) => renderCard(index));
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

  const adjustPanel = createAdjustPanel({
    onAdjustChange: (index, patch) => {
      if (!project) {
        return;
      }
      project = updateStampAdjust(project, index, patch);
      renderCard(index);
    },
    onResetStamp: (index) => {
      if (!project) {
        return;
      }
      project = resetStampAdjust(project, index);
      renderCard(index);
      selectCardAt(index);
    },
    onApplyToAll: (index, fields) => {
      if (!project) {
        return;
      }
      project = applyAdjustToAll(project, index, fields);
      renderAllCards();
      showToast('他の23枚に適用しました。');
    },
    onSetCover: (index) => {
      if (!project) {
        return;
      }
      const previousCover = project.coverIndex;
      project = setCoverIndex(project, index);
      cards[previousCover]?.setCover(false);
      cards[index]?.setCover(true);
      refreshCoverPreview();
      selectCardAt(index);
    },
    onGlobalSettingsChange: (patch) => {
      if (!project) {
        return;
      }
      project = updateGlobalSettings(project, patch);
      scheduleRenderAll();
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
          onFixFrames(project);
        }
      },
    },
  });

  const mainPreviewCanvas = h('canvas', { className: 'cover-preview__canvas cover-preview__canvas--main' });
  const tabPreviewCanvas = h('canvas', { className: 'cover-preview__canvas cover-preview__canvas--tab' });
  const coverPreviewGroup = h('div', { className: 'cover-preview' }, [
    h('div', { className: 'cover-preview__item' }, [mainPreviewCanvas, h('span', { text: 'メイン画像' })]),
    h('div', { className: 'cover-preview__item' }, [tabPreviewCanvas, h('span', { text: 'タブ画像' })]),
  ]);

  const includeTabImageCheckbox = h('input', { attrs: { type: 'checkbox' } });
  includeTabImageCheckbox.checked = true;
  const includeTabImageField = h('div', { className: 'field field--checkbox' }, [
    h('label', { className: 'checkbox-field' }, [includeTabImageCheckbox, ' タブ画像も出力']),
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
        void imageDataLikeToPngBlob(image).then((blob) => downloadBlob(blob, stampFileName(selectedIndex + 1)));
      },
    },
  });

  const exportIssueList = h('ul', { className: 'warning-list' });
  function renderExportIssues(issues: ValidationIssue[]): void {
    exportIssueList.replaceChildren();
    if (issues.length === 0) {
      exportIssueList.append(h('li', { className: 'warning-list__empty', text: '問題は見つかりませんでした。' }));
      return;
    }
    issues.forEach((issue) => exportIssueList.append(h('li', { text: issue.message })));
  }

  const exportButton = h('button', {
    className: 'button button--primary',
    attrs: { type: 'button' },
    text: 'ZIPで書き出し',
    on: { click: () => void handleExport() },
  });

  async function handleExport(): Promise<void> {
    if (!project || !originalImage) {
      showToast('先にシート画像を読み込んでください。', 'error');
      return;
    }
    const currentProject = project;
    const currentImage = originalImage;

    exportButton.setAttribute('disabled', 'true');
    try {
      const emptyIndexes: number[] = [];
      const overflowingIndexes: number[] = [];
      const images: ImageDataLike[] = [];
      const dimensionIssues: ValidationIssue[] = [];

      currentProject.frames.forEach((frame, index) => {
        const resolved = getResolvedStampAdjust(currentProject, index);
        const rendered = renderStamp(currentImage, frame, backgroundColor, currentProject.globalSettings, resolved);
        images[index] = rendered;
        if (!hasOpaquePixels(rendered)) {
          emptyIndexes.push(index);
        }
        if (computeStampWarnings(frame, resolved, currentProject.globalSettings).isOverflowing) {
          overflowingIndexes.push(index);
        }
        dimensionIssues.push(
          ...validateDimensions(`No.${index + 1}`, rendered.width, rendered.height, STAMP_MAX_WIDTH, STAMP_MAX_HEIGHT, index),
        );
      });

      const blobs: Blob[] = [];
      for (const image of images) {
        blobs.push(await imageDataLikeToPngBlob(image));
      }
      const sizeIssues = blobs.flatMap((blob, index) =>
        validateFileSize(`No.${index + 1}`, blob.size, STAMP_MAX_FILE_SIZE_BYTES, index),
      );

      const coverFrame = currentProject.frames[currentProject.coverIndex];
      const coverResolved = getResolvedStampAdjust(currentProject, currentProject.coverIndex);
      const extraFiles: Record<string, Blob> = {};
      let coverIssues: ValidationIssue[] = [];

      if (coverFrame) {
        const mainImage = renderMainImage(currentImage, coverFrame, backgroundColor, currentProject.globalSettings, coverResolved);
        const mainBlob = await imageDataLikeToPngBlob(mainImage);
        extraFiles[MAIN_IMAGE_FILE_NAME] = mainBlob;
        coverIssues = [
          ...coverIssues,
          ...validateDimensions('メイン画像', mainImage.width, mainImage.height, MAIN_IMAGE_SIZE.width, MAIN_IMAGE_SIZE.height),
          ...validateFileSize('メイン画像', mainBlob.size, STAMP_MAX_FILE_SIZE_BYTES),
        ];

        if (includeTabImageCheckbox.checked) {
          const tabImage = renderTabImage(currentImage, coverFrame, backgroundColor, currentProject.globalSettings, coverResolved);
          const tabBlob = await imageDataLikeToPngBlob(tabImage);
          extraFiles[TAB_IMAGE_FILE_NAME] = tabBlob;
          coverIssues = [
            ...coverIssues,
            ...validateDimensions('タブ画像', tabImage.width, tabImage.height, TAB_IMAGE_SIZE.width, TAB_IMAGE_SIZE.height),
            ...validateFileSize('タブ画像', tabBlob.size, STAMP_MAX_FILE_SIZE_BYTES),
          ];
        }
      }

      const allIssues = [
        ...validateEmptyCells(emptyIndexes),
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
        const proceed = window.confirm(`${allIssues.length}件の警告があります。このまま書き出しますか?\n\n${preview}${more}`);
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

  const loadSettingsButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '検出枠・設定をJSONで読み込み',
    on: {
      click: () => {
        if (!project || !originalImage) {
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
              showToast(`設定ファイルの形式が正しくありません(24枚ぶんの設定が必要です)。`, 'error');
              return;
            }
            if (project && parsed.sourceName && parsed.sourceName !== project.sourceName) {
              showToast(`別のシート画像(${parsed.sourceName})の設定のようです。同じシート画像か確認してください。`, 'error');
            }
            project = parsed;
            adjustPanel.setGlobalSettings(project.globalSettings);
            backgroundPicker.setValue(project.preview);
            applyPreviewBackground(project.preview);
            renderAllCards();
            selectCardAt(Math.min(selectedIndex, project.frames.length - 1));
            showToast('検出枠・設定を読み込みました。');
          } catch {
            showToast('設定ファイルの読み込みに失敗しました。', 'error');
          }
        });
      },
    },
  });

  function setProject(image: ImageDataLike, bg: RGB, newProject: ProjectState): void {
    const isNewSheet = project === null || project.sourceName !== newProject.sourceName;
    const effectiveProject = isNewSheet ? setPreview(newProject, loadStoredPreviewPreference()) : newProject;

    originalImage = image;
    backgroundColor = bg;
    project = effectiveProject;

    adjustPanel.setGlobalSettings(project.globalSettings);
    backgroundPicker.setValue(project.preview);
    applyPreviewBackground(project.preview);
    renderAllCards();
    selectCardAt(isNewSheet ? 0 : Math.min(selectedIndex, project.frames.length - 1));
  }

  const topBar = h('div', { className: 'preview-topbar' }, [
    h('div', { className: 'toolbar' }, [fixFramesButton]),
    backgroundPicker.element,
    coverPreviewGroup,
    includeTabImageField,
    h('div', { className: 'toolbar' }, [downloadSelectedButton, saveSettingsButton, loadSettingsButton, exportButton]),
  ]);

  const element = h('div', { className: 'preview-view' }, [
    topBar,
    h('div', { className: 'preview-main' }, [adjustPanel.element, cardsGrid]),
    exportIssueList,
  ]);

  return { element, setProject };
}
