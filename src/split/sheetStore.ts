import type { ImageDataLike } from '../shared/types';
import type { DetectionParams, Sheet } from './types';

/** 読み込めるシートの最大枚数(B-7仕様。メモリ使用量が大きくなりすぎるのを防ぐ)。 */
export const MAX_SHEETS = 8;

/**
 * シート(複数の読み込んだ画像)の管理状態。`sheets` はメタ情報のみで、画像データ本体
 * (ImageDataLike、重いため)は `images`(id→画像)に別途持つ。どちらも`ProjectState`・
 * 設定JSONには含めない(画像はシート選択をやり直してもらう前提。B-6参照)。
 */
export interface SheetStore {
  sheets: Sheet[];
  images: Map<string, ImageDataLike>;
}

export function createSheetStore(): SheetStore {
  return { sheets: [], images: new Map() };
}

let sheetIdSeq = 0;
function createSheetId(): string {
  sheetIdSeq += 1;
  return `sheet-${Date.now().toString(36)}-${sheetIdSeq}`;
}

/** 新しいシートを追加する(枠はまだ空。検出は呼び出し側〈detectView.ts〉が行う)。 */
export function addSheet(
  store: SheetStore,
  name: string,
  image: ImageDataLike,
  detectSettings: DetectionParams,
): { store: SheetStore; sheet: Sheet } {
  const id = createSheetId();
  const sheet: Sheet = {
    id,
    name,
    width: image.width,
    height: image.height,
    detectSettings,
    frames: [],
    frameWarnings: [],
  };
  const images = new Map(store.images);
  images.set(id, image);
  return { store: { sheets: [...store.sheets, sheet], images }, sheet };
}

export function removeSheet(store: SheetStore, id: string): SheetStore {
  const images = new Map(store.images);
  images.delete(id);
  return { sheets: store.sheets.filter((sheet) => sheet.id !== id), images };
}

export function renameSheet(store: SheetStore, id: string, name: string): SheetStore {
  return {
    ...store,
    sheets: store.sheets.map((sheet) => (sheet.id === id ? { ...sheet, name } : sheet)),
  };
}

/** シートの並び順を1つ上下に入れ替える(タブの並べ替え用)。 */
export function reorderSheet(store: SheetStore, id: string, direction: 'up' | 'down'): SheetStore {
  const index = store.sheets.findIndex((sheet) => sheet.id === id);
  if (index === -1) {
    return store;
  }
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= store.sheets.length) {
    return store;
  }
  const sheets = [...store.sheets];
  const current = sheets[index];
  const target = sheets[targetIndex];
  if (!current || !target) {
    return store;
  }
  sheets[index] = target;
  sheets[targetIndex] = current;
  return { ...store, sheets };
}

/** シートのメタ情報(検出設定・frames・frameWarnings等)を部分更新する。 */
export function updateSheet(store: SheetStore, id: string, patch: Partial<Sheet>): SheetStore {
  return {
    ...store,
    sheets: store.sheets.map((sheet) => (sheet.id === id ? { ...sheet, ...patch } : sheet)),
  };
}

export function getSheet(store: SheetStore, id: string): Sheet | undefined {
  return store.sheets.find((sheet) => sheet.id === id);
}

export function getSheetImage(store: SheetStore, id: string): ImageDataLike | undefined {
  return store.images.get(id);
}
