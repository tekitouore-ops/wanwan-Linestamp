import { h } from '../shared/dom';
import { stampFileName } from '../shared/lineSpec';
import { createSliderField, type SliderField } from '../ui/slider';
import {
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_STAMP_ADJUST,
  type BackgroundMode,
  type CropAmount,
  type GlobalSettings,
  type Rect,
  type StampAdjust,
  type StampAdjustFields,
} from './types';

export interface AdjustPanelCallbacks {
  onAdjustChange: (index: number, patch: Partial<StampAdjustFields>) => void;
  onCropChange: (index: number, crop: CropAmount) => void;
  onResetStamp: (index: number) => void;
  onApplyToAll: (index: number, fields: readonly (keyof StampAdjustFields)[]) => void;
  onSetCover: (index: number) => void;
  onGlobalSettingsChange: (patch: Partial<GlobalSettings>) => void;
  onCompareSources: (index: number) => void;
  onBulkSource: () => void;
  /**
   * スライダー・数値入力・チェックボックス等での操作が1手ぶん確定したときに呼ばれる
   * (Undo履歴へのコミット用。修正指示書 項目4参照)。スライダーはドラッグ中は呼ばれず、
   * ドラッグ終了時に1回だけ呼ばれる。ボタン操作(リセット・表紙設定等)は呼び出し側で
   * 対応するコールバック(`onResetStamp`等)のあとに直接コミットするため、ここでは呼ばない。
   */
  onCommit: () => void;
}

export interface ShowForStampParams {
  index: number;
  frame: Rect;
  resolved: StampAdjust;
  isCover: boolean;
  /** 採用元の選択UI(シートが2枚以上のときだけ中身がある、previewView.ts側で用意した要素)。 */
  sourcePickerElement: HTMLElement;
  /** シートが2枚以上あるか(「全シートで比較」「採用元をまとめて設定」ボタンの表示切替に使う)。 */
  hasMultipleSheets: boolean;
  /** 採用元シートの背景の扱い(背景色モードで縁フチ=0のときのヒント表示に使う。修正指示書 項目8参照)。 */
  backgroundMode: BackgroundMode;
}

export interface AdjustPanelHandle {
  element: HTMLElement;
  showForStamp: (params: ShowForStampParams) => void;
  showEmpty: () => void;
  setGlobalSettings: (settings: GlobalSettings) => void;
}

function cropMax(frameSize: number): number {
  return Math.max(0, Math.round(frameSize * 0.4));
}

/** ステップBの左側、選択中スタンプの調整パネルと、折りたたみ式の全体設定を構築する。 */
export function createAdjustPanel(callbacks: AdjustPanelCallbacks): AdjustPanelHandle {
  let currentGlobalSettings: GlobalSettings = DEFAULT_GLOBAL_SETTINGS;
  let currentIndex: number | null = null;

  // ---- 全体設定(折りたたみ、パネル生成時に1度だけ作る) ----

  const outputWidthSlider = createSliderField({
    label: '出力幅',
    unit: 'px',
    min: 100,
    max: DEFAULT_GLOBAL_SETTINGS.outputWidth,
    step: 2,
    value: DEFAULT_GLOBAL_SETTINGS.outputWidth,
    defaultValue: DEFAULT_GLOBAL_SETTINGS.outputWidth,
    onChange: (v) => callbacks.onGlobalSettingsChange({ outputWidth: v }),
    onCommit: () => callbacks.onCommit(),
  });
  const outputHeightSlider = createSliderField({
    label: '出力高さ',
    unit: 'px',
    min: 100,
    max: DEFAULT_GLOBAL_SETTINGS.outputHeight,
    step: 2,
    value: DEFAULT_GLOBAL_SETTINGS.outputHeight,
    defaultValue: DEFAULT_GLOBAL_SETTINGS.outputHeight,
    onChange: (v) => callbacks.onGlobalSettingsChange({ outputHeight: v }),
    onCommit: () => callbacks.onCommit(),
  });
  const innerMarginSlider = createSliderField({
    label: '内側余白',
    unit: 'px',
    min: 0,
    max: 50,
    step: 1,
    value: DEFAULT_GLOBAL_SETTINGS.innerMargin,
    defaultValue: DEFAULT_GLOBAL_SETTINGS.innerMargin,
    onChange: (v) => callbacks.onGlobalSettingsChange({ innerMargin: v }),
    onCommit: () => callbacks.onCommit(),
  });
  const defaultOutlineSlider = createSliderField({
    label: '縁フチの既定値',
    unit: 'px',
    min: 0,
    max: 16,
    step: 1,
    value: DEFAULT_GLOBAL_SETTINGS.defaultOutline,
    defaultValue: DEFAULT_GLOBAL_SETTINGS.defaultOutline,
    onChange: (v) => callbacks.onGlobalSettingsChange({ defaultOutline: v }),
    onCommit: () => callbacks.onCommit(),
  });
  const defaultGhostRemovalSlider = createSliderField({
    label: 'ゴミ除去(半透明のもや)の既定値',
    unit: '%',
    min: 0,
    max: 60,
    step: 1,
    value: DEFAULT_GLOBAL_SETTINGS.defaultGhostRemoval,
    defaultValue: DEFAULT_GLOBAL_SETTINGS.defaultGhostRemoval,
    onChange: (v) => callbacks.onGlobalSettingsChange({ defaultGhostRemoval: v }),
    onCommit: () => callbacks.onCommit(),
  });
  const ghostRemovalHint = h('p', {
    className: 'field__hint',
    text: 'キャラクターの背景に残った半透明のもや(白・灰色・暗い色)を除去します。不透明な白フチや文字は消えません。黒背景で確認すると分かりやすいです。',
  });
  const defaultGhostProtectEdgePxSlider = createSliderField({
    label: 'ゴミ除去の保護範囲の既定値',
    unit: 'px',
    min: 0,
    max: 4,
    step: 1,
    value: DEFAULT_GLOBAL_SETTINGS.defaultGhostProtectEdgePx,
    defaultValue: DEFAULT_GLOBAL_SETTINGS.defaultGhostProtectEdgePx,
    onChange: (v) => callbacks.onGlobalSettingsChange({ defaultGhostProtectEdgePx: v }),
    onCommit: () => callbacks.onCommit(),
  });
  const ghostProtectEdgePxHint = h('p', {
    className: 'field__hint',
    text: '文字や白フチが削れる場合は、値を上げてください。',
  });
  const alphaThresholdSlider = createSliderField({
    label: '透過しきい値',
    min: 1,
    max: 80,
    step: 1,
    value: DEFAULT_GLOBAL_SETTINGS.alphaThreshold,
    defaultValue: DEFAULT_GLOBAL_SETTINGS.alphaThreshold,
    onChange: (v) => callbacks.onGlobalSettingsChange({ alphaThreshold: v }),
    onCommit: () => callbacks.onCommit(),
  });
  const alphaThresholdHint = h('p', {
    className: 'field__hint',
    text: '背景色モードで、AIが描いた白フチが背景と一緒に消えてしまう場合は、この値を下げると消えにくくなります。',
  });
  const featherSlider = createSliderField({
    label: 'エッジのぼかし',
    unit: 'px',
    min: 0,
    max: 3,
    step: 1,
    value: DEFAULT_GLOBAL_SETTINGS.featherPx,
    defaultValue: DEFAULT_GLOBAL_SETTINGS.featherPx,
    onChange: (v) => callbacks.onGlobalSettingsChange({ featherPx: v }),
    onCommit: () => callbacks.onCommit(),
  });

  const alignSelect = h('select', {});
  alignSelect.append(
    h('option', { attrs: { value: 'center' }, text: '中央' }),
    h('option', { attrs: { value: 'bottom' }, text: '下揃え' }),
  );
  alignSelect.value = DEFAULT_GLOBAL_SETTINGS.align;
  alignSelect.addEventListener('change', () => {
    callbacks.onGlobalSettingsChange({
      align: alignSelect.value === 'bottom' ? 'bottom' : 'center',
    });
    callbacks.onCommit();
  });
  const alignField = h('div', { className: 'field' }, [
    h('label', { className: 'field__label', text: '揃え' }),
    alignSelect,
  ]);

  const allowUpscaleCheckbox = h('input', { attrs: { type: 'checkbox' } });
  allowUpscaleCheckbox.checked = DEFAULT_GLOBAL_SETTINGS.allowUpscale;
  allowUpscaleCheckbox.addEventListener('change', () => {
    callbacks.onGlobalSettingsChange({ allowUpscale: allowUpscaleCheckbox.checked });
    callbacks.onCommit();
  });
  const allowUpscaleField = h('div', { className: 'field field--checkbox' }, [
    h('label', { className: 'checkbox-field' }, [
      allowUpscaleCheckbox,
      ' 被写体が小さいときの拡大を許可する',
    ]),
  ]);

  const globalSettingsSection = h('details', { className: 'adjust-panel__global' }, [
    h('summary', { text: '全体設定' }),
    outputWidthSlider.element,
    outputHeightSlider.element,
    innerMarginSlider.element,
    defaultOutlineSlider.element,
    defaultGhostRemovalSlider.element,
    ghostRemovalHint,
    defaultGhostProtectEdgePxSlider.element,
    ghostProtectEdgePxHint,
    alphaThresholdSlider.element,
    alphaThresholdHint,
    featherSlider.element,
    alignField,
    allowUpscaleField,
  ]);

  function setGlobalSettings(settings: GlobalSettings): void {
    currentGlobalSettings = settings;
    outputWidthSlider.setValue(settings.outputWidth);
    outputHeightSlider.setValue(settings.outputHeight);
    innerMarginSlider.setValue(settings.innerMargin);
    defaultOutlineSlider.setValue(settings.defaultOutline);
    defaultGhostRemovalSlider.setValue(settings.defaultGhostRemoval);
    defaultGhostProtectEdgePxSlider.setValue(settings.defaultGhostProtectEdgePx);
    alphaThresholdSlider.setValue(settings.alphaThreshold);
    featherSlider.setValue(settings.featherPx);
    alignSelect.value = settings.align;
    allowUpscaleCheckbox.checked = settings.allowUpscale;
  }

  // ---- 「全体に適用…」ダイアログ(1度だけ作る) ----

  const applyFieldCheckboxes: Record<
    'edgeFix' | 'outline' | 'ghostRemoval' | 'scale' | 'position',
    HTMLInputElement
  > = {
    edgeFix: h('input', { attrs: { type: 'checkbox' } }),
    outline: h('input', { attrs: { type: 'checkbox' } }),
    ghostRemoval: h('input', { attrs: { type: 'checkbox' } }),
    scale: h('input', { attrs: { type: 'checkbox' } }),
    position: h('input', { attrs: { type: 'checkbox' } }),
  };
  Object.values(applyFieldCheckboxes).forEach((checkbox) => {
    checkbox.checked = true;
  });

  const applyDialog = h('dialog', { className: 'apply-all-dialog' }, [
    h('h2', { text: '他の23枚に適用' }),
    h('p', {
      className: 'field__hint',
      text: '選択中のスタンプの値を、チェックした項目だけ他のすべてのスタンプにコピーします。',
    }),
    h('div', { className: 'apply-all-dialog__fields' }, [
      h('label', { className: 'checkbox-field' }, [applyFieldCheckboxes.edgeFix, ' 縁補正']),
      h('label', { className: 'checkbox-field' }, [applyFieldCheckboxes.outline, ' 縁フチ']),
      h('label', { className: 'checkbox-field' }, [applyFieldCheckboxes.ghostRemoval, ' ゴミ除去']),
      h('label', { className: 'checkbox-field' }, [applyFieldCheckboxes.scale, ' 拡大']),
      h('label', { className: 'checkbox-field' }, [applyFieldCheckboxes.position, ' 位置(横・縦)']),
    ]),
    h('div', { className: 'csv-dialog__actions' }, [
      h('button', {
        className: 'button',
        attrs: { type: 'button' },
        text: 'キャンセル',
        on: { click: () => applyDialog.close() },
      }),
      h('button', {
        className: 'button button--primary',
        attrs: { type: 'button' },
        text: '適用',
        on: {
          click: () => {
            if (currentIndex === null) {
              applyDialog.close();
              return;
            }
            const fields: (keyof StampAdjustFields)[] = [];
            if (applyFieldCheckboxes.edgeFix.checked) fields.push('edgeFix');
            if (applyFieldCheckboxes.outline.checked) fields.push('outline');
            if (applyFieldCheckboxes.ghostRemoval.checked) {
              fields.push('ghostRemoval', 'ghostProtectEdgePx');
            }
            if (applyFieldCheckboxes.scale.checked) fields.push('scale');
            if (applyFieldCheckboxes.position.checked) fields.push('offsetX', 'offsetY');
            callbacks.onApplyToAll(currentIndex, fields);
            applyDialog.close();
          },
        },
      }),
    ]),
  ]);
  document.body.append(applyDialog);

  // ---- 選択中スタンプの調整セクション(選択が変わるたびに作り直す) ----

  const stampSection = h('div', { className: 'adjust-panel__stamp' });

  function buildStampSection(params: ShowForStampParams): void {
    const { index, frame, resolved, isCover } = params;

    const edgeFixSlider = createSliderField({
      label: '縁補正',
      unit: 'px',
      min: -5,
      max: 10,
      step: 1,
      value: resolved.edgeFix,
      defaultValue: DEFAULT_STAMP_ADJUST.edgeFix,
      onChange: (v) => callbacks.onAdjustChange(index, { edgeFix: v }),
      onCommit: () => callbacks.onCommit(),
    });
    const outlineHint = h('p', {
      className: 'field__hint',
      text: 'AIが生成画像にすでに白フチを描いている場合は0〜2px程度にしてください。それ以上だとフチが二重になります。',
    });
    const outlineBackgroundModeHint = h('p', {
      className: 'field__hint field__hint--warning',
      text: '推奨: 縁フチを付けてください(背景色モードでは、縁フチ=0のままだとAIが描いた白フチが背景と一緒に透過処理で消えやすくなります)。',
    });
    function updateOutlineBackgroundModeHint(outlineValue: number): void {
      outlineBackgroundModeHint.hidden = !(params.backgroundMode === 'color' && outlineValue === 0);
    }
    updateOutlineBackgroundModeHint(resolved.outline);

    const outlineSlider = createSliderField({
      label: '縁フチ',
      unit: 'px',
      min: 0,
      max: 16,
      step: 1,
      value: resolved.outline,
      defaultValue: currentGlobalSettings.defaultOutline,
      onChange: (v) => {
        callbacks.onAdjustChange(index, { outline: v });
        updateOutlineBackgroundModeHint(v);
      },
      onCommit: () => callbacks.onCommit(),
    });

    const ghostRemovalSlider = createSliderField({
      label: 'ゴミ除去(半透明のもや)',
      unit: '%',
      min: 0,
      max: 60,
      step: 1,
      value: resolved.ghostRemoval,
      defaultValue: currentGlobalSettings.defaultGhostRemoval,
      onChange: (v) => callbacks.onAdjustChange(index, { ghostRemoval: v }),
      onCommit: () => callbacks.onCommit(),
    });
    const ghostRemovalStampHint = h('p', {
      className: 'field__hint',
      text: 'キャラクターの背景に残った半透明のもや(白・灰色・暗い色)を除去します。不透明な白フチや文字は消えません。黒背景で確認すると分かりやすいです。',
    });
    const ghostProtectEdgePxSlider = createSliderField({
      label: 'ゴミ除去の保護範囲',
      unit: 'px',
      min: 0,
      max: 4,
      step: 1,
      value: resolved.ghostProtectEdgePx,
      defaultValue: currentGlobalSettings.defaultGhostProtectEdgePx,
      onChange: (v) => callbacks.onAdjustChange(index, { ghostProtectEdgePx: v }),
      onCommit: () => callbacks.onCommit(),
    });
    const ghostProtectEdgePxStampHint = h('p', {
      className: 'field__hint',
      text: '文字や白フチが削れる場合は、値を上げてください。',
    });

    const cropTopMax = cropMax(frame.height);
    const cropBottomMax = cropMax(frame.height);
    const cropLeftMax = cropMax(frame.width);
    const cropRightMax = cropMax(frame.width);

    function makeCropSlider(
      label: string,
      max: number,
      value: number,
      onChange: (v: number) => void,
    ): SliderField {
      return createSliderField({
        label,
        unit: 'px',
        min: 0,
        max,
        step: 1,
        value,
        defaultValue: 0,
        onChange,
        onCommit: () => callbacks.onCommit(),
      });
    }

    const cropTopSlider = makeCropSlider('切り抜き(上)', cropTopMax, resolved.crop.top, (v) =>
      callbacks.onCropChange(index, { ...resolved.crop, top: v }),
    );
    const cropRightSlider = makeCropSlider('切り抜き(右)', cropRightMax, resolved.crop.right, (v) =>
      callbacks.onCropChange(index, { ...resolved.crop, right: v }),
    );
    const cropBottomSlider = makeCropSlider(
      '切り抜き(下)',
      cropBottomMax,
      resolved.crop.bottom,
      (v) => callbacks.onCropChange(index, { ...resolved.crop, bottom: v }),
    );
    const cropLeftSlider = makeCropSlider('切り抜き(左)', cropLeftMax, resolved.crop.left, (v) =>
      callbacks.onCropChange(index, { ...resolved.crop, left: v }),
    );

    const scaleSlider = createSliderField({
      label: '拡大',
      unit: '%',
      min: 20,
      max: 300,
      step: 1,
      value: resolved.scale,
      defaultValue: DEFAULT_STAMP_ADJUST.scale,
      onChange: (v) => callbacks.onAdjustChange(index, { scale: v }),
      onCommit: () => callbacks.onCommit(),
    });
    const offsetXSlider = createSliderField({
      label: '横位置',
      unit: 'px',
      min: -150,
      max: 150,
      step: 1,
      value: resolved.offsetX,
      defaultValue: DEFAULT_STAMP_ADJUST.offsetX,
      onChange: (v) => callbacks.onAdjustChange(index, { offsetX: v }),
      onCommit: () => callbacks.onCommit(),
    });
    const offsetYSlider = createSliderField({
      label: '縦位置',
      unit: 'px',
      min: -150,
      max: 150,
      step: 1,
      value: resolved.offsetY,
      defaultValue: DEFAULT_STAMP_ADJUST.offsetY,
      onChange: (v) => callbacks.onAdjustChange(index, { offsetY: v }),
      onCommit: () => callbacks.onCommit(),
    });

    const coverButton = h('button', {
      className: `button${isCover ? ' button--active' : ''}`,
      attrs: { type: 'button' },
      text: isCover ? '表紙(選択中)' : '表紙に設定',
      on: { click: () => callbacks.onSetCover(index) },
    });
    const resetButton = h('button', {
      className: 'button',
      attrs: { type: 'button' },
      text: 'この1枚をリセット',
      on: { click: () => callbacks.onResetStamp(index) },
    });
    const applyAllButton = h('button', {
      className: 'button',
      attrs: { type: 'button' },
      text: '全体に適用…',
      on: { click: () => applyDialog.showModal() },
    });
    const compareButton = h('button', {
      className: 'button',
      attrs: { type: 'button' },
      text: '全シートで比較…',
      on: { click: () => callbacks.onCompareSources(index) },
    });
    const bulkSourceButton = h('button', {
      className: 'button',
      attrs: { type: 'button' },
      text: '採用元をまとめて設定…',
      on: { click: () => callbacks.onBulkSource() },
    });
    const sourceButtonsRow = h('div', { className: 'toolbar' }, [compareButton, bulkSourceButton]);
    sourceButtonsRow.hidden = !params.hasMultipleSheets;

    stampSection.replaceChildren(
      h('p', { className: 'adjust-panel__title', text: `${stampFileName(index + 1)} を調整中` }),
      params.sourcePickerElement,
      h('h4', { className: 'split-section-heading', text: '補正' }),
      edgeFixSlider.element,
      outlineSlider.element,
      outlineHint,
      outlineBackgroundModeHint,
      ghostRemovalSlider.element,
      ghostRemovalStampHint,
      ghostProtectEdgePxSlider.element,
      ghostProtectEdgePxStampHint,
      h('h4', { className: 'split-section-heading', text: '切り抜き' }),
      cropTopSlider.element,
      cropRightSlider.element,
      cropBottomSlider.element,
      cropLeftSlider.element,
      h('h4', { className: 'split-section-heading', text: '配置' }),
      scaleSlider.element,
      offsetXSlider.element,
      offsetYSlider.element,
      h('div', { className: 'toolbar' }, [coverButton]),
      h('div', { className: 'toolbar' }, [resetButton, applyAllButton]),
      sourceButtonsRow,
    );
  }

  function showForStamp(params: ShowForStampParams): void {
    currentIndex = params.index;
    buildStampSection(params);
  }

  function showEmpty(): void {
    currentIndex = null;
    stampSection.replaceChildren(
      h('p', { className: 'field__hint', text: 'カードを選択すると、ここで調整できます。' }),
    );
  }
  showEmpty();

  const element = h('div', { className: 'adjust-panel' }, [globalSettingsSection, stampSection]);

  return { element, showForStamp, showEmpty, setGlobalSettings };
}
