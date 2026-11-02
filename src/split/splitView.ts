import { h } from '../shared/dom';
import { createDetectView } from './detectView';
import { confirmSheets } from './editorState';
import { createPreviewView } from './previewView';
import type { ProjectState } from './types';

/**
 * タブ②(画像分割・書き出し)の画面を構築する。
 * ステップA(検出・枠編集。detectView.ts。複数シート対応)とステップB(プレビュー・調整。previewView.ts)を
 * 同じ画面内で切り替えるオーケストレータ。
 */
export function createSplitView(): HTMLElement {
  let project: ProjectState | null = null;

  function showStepA(): void {
    detectElement.hidden = false;
    previewElement.hidden = true;
  }

  function showStepB(): void {
    detectElement.hidden = true;
    previewElement.hidden = false;
  }

  const previewView = createPreviewView((store, latestProject) => {
    // 「枠を修正」: ステップBでの調整内容(採用元・個別設定)を引き継いだ上でステップAへ戻り、
    // 現在のシート一式をそのまま再表示する。
    project = latestProject;
    const activeSheetId = project.sheets[0]?.id ?? null;
    detectView.openWithExisting(store, activeSheetId);
    showStepA();
  });

  const detectView = createDetectView((store) => {
    // 「この枠で確定」: 既存のプロジェクト状態があれば、採用元シートの枠が変わっていない
    // スタンプの個別設定を引き継いでステップBへ進む(confirmSheets参照)。
    project = confirmSheets(project, store.sheets);
    previewView.setProject(store, project);
    showStepB();
  });

  const detectElement = detectView.element;
  const previewElement = previewView.element;
  previewElement.hidden = true;

  return h('div', { className: 'split-root' }, [detectElement, previewElement]);
}
