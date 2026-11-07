import type { Rect } from './types';

/**
 * ステップAの検出画面(`detectView.ts`)で、指定した枠(`Rect`、元画像px)が画面内に余裕を持って
 * 収まるように、ズーム・パン(カメラ)を計算する(DOM非依存の純粋関数。追加修正指示書 第6弾
 * 項目23。ステップBから「枠の調整に戻る」で戻ったときに、選択していたスタンプの枠を自動的に
 * 見えるようにするために使う)。
 */

export interface Camera {
  zoom: number;
  panX: number;
  panY: number;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

export function computeCameraToFitBox(
  box: Rect,
  viewportWidth: number,
  viewportHeight: number,
  baseScale: number,
  marginRatio = 0.3,
): Camera {
  const marginW = box.width * marginRatio;
  const marginH = box.height * marginRatio;
  const targetWidth = Math.max(1, box.width + marginW * 2);
  const targetHeight = Math.max(1, box.height + marginH * 2);

  const fitScale = Math.min(viewportWidth / targetWidth, viewportHeight / targetHeight);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitScale / baseScale));
  const scale = baseScale * zoom;

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const panX = centerX - viewportWidth / 2 / scale;
  const panY = centerY - viewportHeight / 2 / scale;

  return { zoom, panX, panY };
}
