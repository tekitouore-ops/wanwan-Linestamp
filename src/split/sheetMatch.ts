import type { ProjectState, Sheet } from './types';

/** 名前・サイズでの突き合わせに必要な最小限の情報。 */
export interface SheetIdentity {
  id: string;
  name: string;
  width: number;
  height: number;
}

/** 自動対応づけできなかった保存シート1件ぶんの、ダイアログ表示用の情報。 */
export interface SheetAssignmentRow {
  savedSheet: Sheet;
  /** 名前が一致する現在のシートのid(サイズが違う場合も含む)。プルダウンの既定選択に使う。なければundefined。 */
  suggestedSheetId: string | undefined;
  /** 名前は一致したがサイズが違う場合true(「サイズが違います」の注意表示に使う)。 */
  sizeMismatch: boolean;
}

export interface SheetMatchResult {
  /** 自動対応づけできた分(名前・サイズともに一致)。保存シートid→現在のシートid。 */
  idMap: Record<string, string>;
  /** ダイアログでの手動割り当てが必要な、残りの保存シート。 */
  needsAssignment: SheetAssignmentRow[];
}

/**
 * 保存されていたシート(`savedSheets`)を、現在読み込み済みのシート(`currentSheets`)と
 * 名前・サイズで突き合わせる。名前とサイズの両方が一致するものは自動対応づけし、
 * 名前だけ一致してサイズが違うものは候補として扱う(自動では対応づけない)。
 * どちらにも該当しない保存シートも「対応づけなし」の候補として返す(手動割り当て用)。
 * 1枚の現在のシートは、先に一致した1件の保存シートにのみ自動対応づけられる(重複しない)。
 */
export function matchSheetsByNameAndSize(
  savedSheets: Sheet[],
  currentSheets: SheetIdentity[],
): SheetMatchResult {
  const idMap: Record<string, string> = {};
  const usedCurrentIds = new Set<string>();
  const needsAssignment: SheetAssignmentRow[] = [];

  for (const saved of savedSheets) {
    const exactMatch = currentSheets.find(
      (current) =>
        !usedCurrentIds.has(current.id) &&
        current.name === saved.name &&
        current.width === saved.width &&
        current.height === saved.height,
    );
    if (exactMatch) {
      idMap[saved.id] = exactMatch.id;
      usedCurrentIds.add(exactMatch.id);
      continue;
    }

    const nameOnlyMatch = currentSheets.find((current) => current.name === saved.name);
    needsAssignment.push({
      savedSheet: saved,
      suggestedSheetId: nameOnlyMatch?.id,
      sizeMismatch: Boolean(nameOnlyMatch),
    });
  }

  return { idMap, needsAssignment };
}

/**
 * 保存シートid→現在のシートidの対応づけ(`idMap`、「割り当てない」はエントリなし)を使って、
 * 読み込んだProjectStateのsheets/stampsのidを現在のセッションのものへ付け替える。
 * 割り当てなかった保存シートは、そのままのid(画像なし)で残す。呼び出し側(renderCard)が
 * 「採用元のシートが見つかりません」として扱う(対応する画像がstoreに存在しないため)。
 */
export function remapProjectIds(
  parsed: ProjectState,
  idMap: Map<string, string>,
  currentSheets: Sheet[],
): ProjectState {
  const remappedSheets = parsed.sheets.map((sheet) => {
    const currentSheet = currentSheets.find((s) => s.id === idMap.get(sheet.id));
    return currentSheet
      ? { ...sheet, id: currentSheet.id, width: currentSheet.width, height: currentSheet.height }
      : sheet;
  });

  return {
    ...parsed,
    sheets: remappedSheets,
    stamps: parsed.stamps.map((setting) => ({
      sourceSheetId: idMap.get(setting.sourceSheetId) ?? setting.sourceSheetId,
      adjust: setting.adjust,
      cropBySheet: Object.fromEntries(
        Object.entries(setting.cropBySheet).map(([sheetId, crop]) => [
          idMap.get(sheetId) ?? sheetId,
          crop,
        ]),
      ),
      eraseMaskBySheet: Object.fromEntries(
        Object.entries(setting.eraseMaskBySheet).map(([sheetId, mask]) => [
          idMap.get(sheetId) ?? sheetId,
          mask,
        ]),
      ),
    })),
  };
}

/** 割り当てられなかった保存シートの数(読込後の警告トースト表示用)。 */
export function countUnassignedSheets(parsed: ProjectState, idMap: Map<string, string>): number {
  return parsed.sheets.length - idMap.size;
}
