/**
 * 手動消しゴムのブラシ処理(DOM非依存の純粋ロジック部分)。`eraseEditor.ts`から呼ぶ。
 * ストローク中に何度も呼ばれるため、`applyBrushStamp`はマスク配列を直接書き換える
 * (都度新しい配列を確保するコストを避けるため。追加修正指示書 第5弾 項目19)。
 */

export type BrushMode = 'erase' | 'restore';

/**
 * 中心(cx, cy)・半径radiusPxの円形ブラシを1回スタンプする。
 * `hardness`(0〜1)が高いほど縁の硬さが増す(内側`radius*hardness`までは強さ1、
 * それ以降`radius`まで線形に0へ減衰する)。`erase`は値を255側へ(`Math.max`で合成)、
 * `restore`は値を0側へ(`Math.min`で合成)寄せるため、同じストローク内で重ね塗りしても
 * 不自然に濃淡が強まらない。
 */
export function applyBrushStamp(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number,
  hardness: number,
  mode: BrushMode,
): void {
  const radius = Math.max(0.5, radiusPx);
  const innerRadius = radius * Math.min(1, Math.max(0, hardness));
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > radius) {
        continue;
      }
      let strength = 1;
      if (dist > innerRadius && radius > innerRadius) {
        strength = 1 - (dist - innerRadius) / (radius - innerRadius);
      }
      strength = Math.min(1, Math.max(0, strength));
      if (strength <= 0) {
        continue;
      }
      const p = y * width + x;
      const current = mask[p] ?? 0;
      if (mode === 'erase') {
        mask[p] = Math.max(current, Math.round(255 * strength));
      } else {
        mask[p] = Math.min(current, Math.round(255 * (1 - strength)));
      }
    }
  }
}

export interface BrushPoint {
  x: number;
  y: number;
}

/**
 * `from`から`to`まで、`stepPx`間隔で補間した点列を返す(`to`を含む、`from`は含まない)。
 * ポインター移動イベントの間隔が粗くても、ブラシ痕が途切れないようにするために使う。
 */
export function interpolateBrushPoints(
  from: BrushPoint,
  to: BrushPoint,
  stepPx: number,
): BrushPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const step = Math.max(0.5, stepPx);
  if (distance <= step) {
    return [to];
  }
  const steps = Math.ceil(distance / step);
  const points: BrushPoint[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    points.push({ x: from.x + dx * t, y: from.y + dy * t });
  }
  return points;
}
