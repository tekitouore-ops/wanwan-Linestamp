import { MAIN_IMAGE_SIZE, TAB_IMAGE_SIZE } from '../shared/lineSpec';
import type { ImageDataLike, RGB } from '../shared/types';
import type { BackgroundMode, GlobalSettings, Rect, StampAdjust } from '../split/types';
import { renderStamp } from './renderStamp';

/**
 * 通常スタンプの「内側余白 ÷ 出力幅」の比率を保ったまま、別サイズのキャンバス用の
 * 内側余白(px)を計算する。小さいキャンバス(main.png/tab.png)に通常スタンプと同じ絶対px数の
 * 余白を使うと、相対的に余白が大きくなりすぎるため(docs/decisions.md参照)。
 */
export function computeMarginForSize(globalSettings: GlobalSettings, targetWidth: number): number {
  const ratio = globalSettings.innerMargin / globalSettings.outputWidth;
  return Math.max(0, Math.round(ratio * targetWidth));
}

function settingsForSize(
  globalSettings: GlobalSettings,
  width: number,
  height: number,
): GlobalSettings {
  return {
    ...globalSettings,
    outputWidth: width,
    outputHeight: height,
    innerMargin: computeMarginForSize(globalSettings, width),
  };
}

/** 表紙スタンプの調整結果を引き継ぎ、メイン画像(240×240)を生成する。 */
export function renderMainImage(
  sourceImage: ImageDataLike,
  frame: Rect,
  backgroundColor: RGB,
  globalSettings: GlobalSettings,
  adjust: StampAdjust,
  backgroundMode: BackgroundMode = 'color',
): ImageDataLike {
  const settings = settingsForSize(globalSettings, MAIN_IMAGE_SIZE.width, MAIN_IMAGE_SIZE.height);
  return renderStamp(sourceImage, frame, backgroundColor, settings, adjust, backgroundMode);
}

/** 表紙スタンプの調整結果を引き継ぎ、タブ画像(96×74)を生成する。 */
export function renderTabImage(
  sourceImage: ImageDataLike,
  frame: Rect,
  backgroundColor: RGB,
  globalSettings: GlobalSettings,
  adjust: StampAdjust,
  backgroundMode: BackgroundMode = 'color',
): ImageDataLike {
  const settings = settingsForSize(globalSettings, TAB_IMAGE_SIZE.width, TAB_IMAGE_SIZE.height);
  return renderStamp(sourceImage, frame, backgroundColor, settings, adjust, backgroundMode);
}

export interface CoverImages {
  main: ImageDataLike;
  tab: ImageDataLike;
}

/** 表紙スタンプから main.png・tab.png の両方を生成する。 */
export function renderCoverImages(
  sourceImage: ImageDataLike,
  frame: Rect,
  backgroundColor: RGB,
  globalSettings: GlobalSettings,
  adjust: StampAdjust,
  backgroundMode: BackgroundMode = 'color',
): CoverImages {
  return {
    main: renderMainImage(
      sourceImage,
      frame,
      backgroundColor,
      globalSettings,
      adjust,
      backgroundMode,
    ),
    tab: renderTabImage(
      sourceImage,
      frame,
      backgroundColor,
      globalSettings,
      adjust,
      backgroundMode,
    ),
  };
}
