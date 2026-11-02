import { h } from '../shared/dom';
import type { ImageDataLike } from '../shared/types';
import { createDetectView } from './detectView';
import { confirmFrames } from './editorState';
import { createPreviewView } from './previewView';
import type { ProjectState } from './types';

/**
 * タブ②(画像分割・書き出し)の画面を構築する。
 * ステップA(検出・枠編集。detectView.ts)とステップB(プレビュー・調整。previewView.ts)を
 * 同じ画面内で切り替えるオーケストレータ。
 */
export function createSplitView(): HTMLElement {
  let project: ProjectState | null = null;
  let currentImage: ImageDataLike | null = null;

  function showStepA(): void {
    detectElement.hidden = false;
    previewElement.hidden = true;
  }

  function showStepB(): void {
    detectElement.hidden = true;
    previewElement.hidden = false;
  }

  const previewView = createPreviewView((latestProject) => {
    // 「枠を修正」: ステップBでの調整内容を引き継いだ上でステップAへ戻り、現在の画像・枠を再表示する。
    if (!currentImage) {
      return;
    }
    project = latestProject;
    detectView.openWithExisting(currentImage, project.sourceName, project.frames);
    showStepA();
  });

  const detectView = createDetectView((image, sourceName, frames, backgroundColor) => {
    // 「この枠で確定」: 既存のプロジェクト状態があれば、枠が変わっていないスタンプの
    // 個別設定を引き継いでステップBへ進む(confirmFrames参照)。
    project = confirmFrames(project, sourceName, frames);
    currentImage = image;
    previewView.setProject(image, backgroundColor, project);
    showStepB();
  });

  const detectElement = detectView.element;
  const previewElement = previewView.element;
  previewElement.hidden = true;

  return h('div', { className: 'split-root' }, [detectElement, previewElement]);
}
