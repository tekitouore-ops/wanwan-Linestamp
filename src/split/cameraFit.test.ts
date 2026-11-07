import { describe, expect, it } from 'vitest';
import { computeCameraToFitBox } from './cameraFit';

describe('computeCameraToFitBox', () => {
  it('枠の中心が、ビューポートの中心に来るようにパンする', () => {
    const box = { x: 100, y: 100, width: 50, height: 50 };
    const camera = computeCameraToFitBox(box, 900, 600, 1, 0.3);
    const scale = camera.zoom * 1;
    const screenCenterX = (box.x + box.width / 2 - camera.panX) * scale;
    const screenCenterY = (box.y + box.height / 2 - camera.panY) * scale;
    expect(screenCenterX).toBeCloseTo(450, 1);
    expect(screenCenterY).toBeCloseTo(300, 1);
  });

  it('小さい枠は拡大される(zoom > baseScale相当の1倍)', () => {
    const box = { x: 0, y: 0, width: 20, height: 20 };
    const camera = computeCameraToFitBox(box, 900, 600, 1, 0.3);
    expect(camera.zoom).toBeGreaterThan(1);
  });

  it('大きい枠は縮小される(zoom < 1)', () => {
    const box = { x: 0, y: 0, width: 4000, height: 3000 };
    const camera = computeCameraToFitBox(box, 900, 600, 1, 0.3);
    expect(camera.zoom).toBeLessThan(1);
  });

  it('ズーム倍率は上限・下限でクランプされる', () => {
    const tiny = { x: 0, y: 0, width: 1, height: 1 };
    const huge = { x: 0, y: 0, width: 100000, height: 100000 };
    const zoomedIn = computeCameraToFitBox(tiny, 900, 600, 1, 0.3);
    const zoomedOut = computeCameraToFitBox(huge, 900, 600, 1, 0.3);
    expect(zoomedIn.zoom).toBeLessThanOrEqual(4);
    expect(zoomedOut.zoom).toBeGreaterThanOrEqual(0.5);
  });

  it('baseScaleが1でない場合も、最終的な画面上のズーム(zoom*baseScale)が指定幅に収まる', () => {
    const box = { x: 0, y: 0, width: 256, height: 256 };
    const baseScale = 0.5859375; // 900/1536相当
    const camera = computeCameraToFitBox(box, 900, 600, baseScale, 0.3);
    const scale = camera.zoom * baseScale;
    const visibleWidth = 900 / scale;
    // マージン込みの枠サイズ(256*1.6=409.6)が、画面に見えている範囲に収まっていること。
    expect(visibleWidth).toBeGreaterThanOrEqual(256 * 1.6 - 1);
  });
});
