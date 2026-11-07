import { h, shouldHandleEnter } from '../shared/dom';
import { downloadTextFile, openFilePicker } from '../shared/file';
import { STAMP_COUNT } from '../shared/lineSpec';
import { createDropzone } from '../ui/dropzone';
import { showToast } from '../ui/toast';
import { buildCsvTemplate, parseRows } from './csv';
import { buildPrompt } from './buildPrompt';
import { CONTENT_HEADING } from './fixedText';
import { deserializeProject, serializeProject } from './projectFile';
import {
  countFilledRows,
  createEmptyRows,
  DEFAULT_PROMPT_SETTINGS,
  findEmptyLineRowNumbers,
  findEmptySituationRowNumbers,
  findIncompleteRowNumbers,
  type PromptSettings,
  type StampRow,
} from './types';

const STORAGE_KEY = 'wanwan-linestamp:prompt-state:v2';
/** 旧キー(保存データがPROJECT_FILE_VERSION 1だった頃のもの)。読み込み時に見つかれば新キーへ移行し、削除する。 */
const LEGACY_STORAGE_KEY = 'wanwan-linestamp:prompt-state:v1';

interface ReferenceImageState {
  fileName: string;
  dataUrl: string;
}

interface PromptViewState {
  rows: StampRow[];
  settings: PromptSettings;
  referenceImage: ReferenceImageState | null;
}

function debounce(fn: () => void, delayMs: number): () => void {
  let timer: number | undefined;
  return () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(fn, delayMs);
  };
}

/**
 * localStorageから自動保存データを読み込む。新キー(v2)がなければ、旧キー(v1)からの移行を試みる
 * (セリフ・状況だけ引き継ぎ、新キーへ保存し直して旧キーを削除する。修正指示書 項目6参照)。
 */
function loadPersistedState(): { rows: StampRow[]; settings: PromptSettings } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const result = deserializeProject(raw);
      return result.ok ? { rows: result.rows, settings: result.settings } : null;
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) {
      return null;
    }
    const legacyResult = deserializeProject(legacyRaw);
    if (!legacyResult.ok) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      return null;
    }
    persistState(legacyResult.rows, legacyResult.settings);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    return { rows: legacyResult.rows, settings: legacyResult.settings };
  } catch {
    return null;
  }
}

function persistState(rows: StampRow[], settings: PromptSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeProject(rows, settings));
  } catch {
    // 容量超過・プライベートモード等は自動保存の失敗として無視する(補助機能のため)。
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function formatTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function createSectionHeading(text: string): HTMLElement {
  return h('h2', { className: 'section-heading', text });
}

function createField(labelText: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = `field-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  const children: Array<Node | string> = [
    h('label', { className: 'field__label', attrs: { for: id }, text: labelText }),
    control,
  ];
  if (hint) {
    children.push(h('p', { className: 'field__hint', text: hint }));
  }
  return h('div', { className: 'field' }, children);
}

/** 参照画像の登録セクション(メモリ上のみで保持。ページを閉じると消える)。 */
function createReferenceImageSection(state: PromptViewState): HTMLElement {
  const previewImg = h('img', {
    className: 'reference-image__preview',
    attrs: { alt: '参照画像のプレビュー' },
  });
  const removeButton = h('button', {
    className: 'button button--text',
    attrs: { type: 'button' },
    text: 'この参照画像を削除',
    on: {
      click: () => {
        state.referenceImage = null;
        updatePreview();
      },
    },
  });

  function updatePreview(): void {
    if (state.referenceImage) {
      previewImg.src = state.referenceImage.dataUrl;
      previewImg.hidden = false;
      removeButton.hidden = false;
    } else {
      previewImg.src = '';
      previewImg.hidden = true;
      removeButton.hidden = true;
    }
  }

  const dropzone = createDropzone({
    label: '参照画像をドラッグ&ドロップ、またはクリックして選択',
    hint: 'キャラクターの元絵を1枚登録してください(差し替えも同じ操作でできます)',
    onFile: (file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          state.referenceImage = { fileName: file.name, dataUrl: reader.result };
          updatePreview();
        }
      };
      reader.onerror = () => {
        showToast('画像の読み込みに失敗しました。別のファイルをお試しください。', 'error');
      };
      reader.readAsDataURL(file);
    },
    onInvalidFile: (message) => showToast(message, 'error'),
  });

  updatePreview();

  return h('div', { className: 'reference-image' }, [dropzone, previewImg, removeButton]);
}

interface RowsTableHandle {
  element: HTMLElement;
  refresh: () => void;
}

/** 24行の入力表(No./セリフ/状況)。各セルは `state.rows` を直接書き換える(入力中のフォーカスを保つため)。 */
function createRowsTable(state: PromptViewState, onChange: () => void): RowsTableHandle {
  type Column = 'line' | 'situation';
  const columns: Column[] = ['line', 'situation'];
  const inputs: Record<Column, HTMLInputElement>[] = [];
  const tbody = h('tbody');

  /**
   * IME変換確定時の誤操作防止(追加修正指示書 第8弾 項目27)。`compositionend`は、
   * どの行の入力欄から発生しても`tbody`までバブリングするため、ここで一括して捕まえる。
   */
  let lastCompositionEndTime: number | null = null;
  tbody.addEventListener('compositionend', (event) => {
    lastCompositionEndTime = event.timeStamp;
  });

  for (let index = 0; index < state.rows.length; index += 1) {
    const lineInput = h('input', {
      className: 'rows-table__input',
      attrs: { type: 'text', 'aria-label': `No.${index + 1} セリフ` },
    });
    const situationInput = h('input', {
      className: 'rows-table__input',
      attrs: { type: 'text', 'aria-label': `No.${index + 1} 状況` },
    });
    const rowInputs: Record<Column, HTMLInputElement> = {
      line: lineInput,
      situation: situationInput,
    };

    lineInput.addEventListener('input', () => {
      const row = state.rows[index];
      if (row) {
        row.line = lineInput.value;
      }
      onChange();
    });
    situationInput.addEventListener('input', () => {
      const row = state.rows[index];
      if (row) {
        row.situation = situationInput.value;
      }
      onChange();
    });

    columns.forEach((column) => {
      rowInputs[column].addEventListener('keydown', (event) => {
        if (!shouldHandleEnter(event, lastCompositionEndTime)) {
          // IME変換中の確定Enterは、何もしない(確定のみを行わせる)。
          return;
        }
        event.preventDefault();
        inputs[index + 1]?.[column].focus();
      });
    });

    inputs.push(rowInputs);
    tbody.append(
      h('tr', {}, [
        h('td', { className: 'rows-table__no', text: String(index + 1) }),
        h('td', {}, [lineInput]),
        h('td', {}, [situationInput]),
      ]),
    );
  }

  const table = h('table', { className: 'rows-table' }, [
    h('thead', {}, [
      h('tr', {}, [
        h('th', { className: 'rows-table__no', text: 'No.' }),
        h('th', { text: 'セリフ' }),
        h('th', { text: '状況' }),
      ]),
    ]),
    tbody,
  ]);

  function refresh(): void {
    inputs.forEach((rowInputs, index) => {
      const row = state.rows[index];
      if (!row) {
        return;
      }
      rowInputs.line.value = row.line;
      rowInputs.situation.value = row.situation;
    });
  }
  // 初期表示(localStorageからの復元・v1からの移行分を含む)を入力欄へ反映する。
  refresh();

  return { element: h('div', { className: 'rows-table-wrapper' }, [table]), refresh };
}

interface SettingsFormHandle {
  element: HTMLElement;
  refresh: () => void;
}

/** 共通設定: キャラクター補足・追加指示(どちらも任意)と、背景透過(固定)の読み取り専用表示。 */
function createSettingsForm(state: PromptViewState, onChange: () => void): SettingsFormHandle {
  const characterNoteInput = h('textarea', {
    attrs: { rows: '2', placeholder: '例: フランスパンのキャラクター。目は小さな点、手足は丸い' },
  });
  characterNoteInput.addEventListener('input', () => {
    state.settings.characterNote = characterNoteInput.value;
    onChange();
  });

  const additionalInstructionsInput = h('textarea', {
    attrs: { rows: '2', placeholder: '例: 影は描かない' },
  });
  additionalInstructionsInput.addEventListener('input', () => {
    state.settings.additionalInstructions = additionalInstructionsInput.value;
    onChange();
  });

  const backgroundField = h('div', { className: 'field' }, [
    h('span', { className: 'field__label', text: '背景' }),
    h('p', { text: '透過(固定)' }),
    h('p', {
      className: 'field__hint',
      text: 'ChatGPTが透過PNGを返さず、白背景や市松模様の画像が返ることがあります。その場合は、タブ②で背景色モードに切り替えて処理してください。「透過PNGで」と再指示するのも有効です。',
    }),
  ]);

  function refresh(): void {
    characterNoteInput.value = state.settings.characterNote;
    additionalInstructionsInput.value = state.settings.additionalInstructions;
  }
  refresh();

  const element = h('div', { className: 'settings-form' }, [
    createField('キャラクター補足(任意)', characterNoteInput),
    createField('追加指示(任意)', additionalInstructionsInput),
    backgroundField,
  ]);

  return { element, refresh };
}

interface SummaryHandle {
  element: HTMLElement;
  refresh: () => void;
}

/** 「プロンプトを生成」直前のサマリー表示: 入力済み行数、セリフ/状況が空の行番号。 */
function createSummary(state: PromptViewState): SummaryHandle {
  const filledLine = h('p', {});
  const emptyLineLine = h('p', { className: 'field__hint' });
  const emptySituationLine = h('p', { className: 'field__hint' });

  function refresh(): void {
    const filled = countFilledRows(state.rows);
    filledLine.textContent = `入力済み: ${filled}/${STAMP_COUNT}行`;

    const emptyLineNumbers = findEmptyLineRowNumbers(state.rows);
    emptyLineLine.textContent =
      emptyLineNumbers.length === 0
        ? 'セリフが空の行: なし'
        : `セリフが空の行: No. ${emptyLineNumbers.join(', ')}`;

    const emptySituationNumbers = findEmptySituationRowNumbers(state.rows);
    emptySituationLine.textContent =
      emptySituationNumbers.length === 0
        ? '状況が空の行: なし'
        : `状況が空の行: No. ${emptySituationNumbers.join(', ')}`;
  }
  refresh();

  return {
    element: h('div', { className: 'callout' }, [filledLine, emptyLineLine, emptySituationLine]),
    refresh,
  };
}

function createCsvDialog(onApply: (text: string) => void): { open: () => void } {
  const textarea = h('textarea', {
    className: 'csv-dialog__textarea',
    attrs: {
      rows: '14',
      placeholder:
        'セリフ,状況\nやっほー,朝に手を振る\n...\n\nまたは『セリフ』｜状況の形式でも貼り付けられます。',
    },
  });

  const dialog = h('dialog', { className: 'csv-dialog' }, [
    h('h2', { text: '貼り付け' }),
    h('p', {
      className: 'csv-dialog__hint',
      text: '列順は「セリフ,状況」。ヘッダー行はあってもなくても構いません。『セリフ』｜状況の形式でも自動判定して取り込めます。24行を超える分は無視し、足りない分は空欄にします。',
    }),
    textarea,
    h('div', { className: 'csv-dialog__actions' }, [
      h('button', {
        className: 'button',
        attrs: { type: 'button' },
        text: 'キャンセル',
        on: { click: () => dialog.close() },
      }),
      h('button', {
        className: 'button button--primary',
        attrs: { type: 'button' },
        text: '表に反映',
        on: {
          click: () => {
            onApply(textarea.value);
            dialog.close();
          },
        },
      }),
    ]),
  ]);

  document.body.append(dialog);

  return {
    open: () => {
      textarea.value = '';
      dialog.showModal();
      textarea.focus();
    },
  };
}

/** タブ①(プロンプト作成)の画面全体を構築する。 */
export function createPromptView(): HTMLElement {
  const persisted = loadPersistedState();
  const state: PromptViewState = {
    rows: persisted?.rows ?? createEmptyRows(),
    settings: persisted?.settings ?? { ...DEFAULT_PROMPT_SETTINGS },
    referenceImage: null,
  };

  const scheduleSave = debounce(() => persistState(state.rows, state.settings), 500);

  const warningBanner = h('p', { className: 'warning-banner' });
  function updateWarningBanner(): void {
    const numbers = findIncompleteRowNumbers(state.rows);
    warningBanner.hidden = numbers.length === 0;
    warningBanner.textContent =
      numbers.length === 0
        ? ''
        : `セリフ・状況がどちらも未入力の行があります(No. ${numbers.join(', ')})。未入力のままでもプロンプトは生成できます。`;
  }

  const summary = createSummary(state);
  function handleChange(): void {
    updateWarningBanner();
    summary.refresh();
    scheduleSave();
  }

  const rowsTable = createRowsTable(state, handleChange);
  const settingsForm = createSettingsForm(state, handleChange);

  const csvDialog = createCsvDialog((text) => {
    const { rows, warnings } = parseRows(text);
    state.rows.splice(0, state.rows.length, ...rows);
    rowsTable.refresh();
    handleChange();
    if (warnings.length > 0) {
      warnings.forEach((warning) => showToast(warning, 'error'));
    } else {
      showToast('表に反映しました。');
    }
  });

  let lastPrompt = '';
  const outputFixedTextarea = h('textarea', {
    className: 'output__textarea output__textarea--fixed',
    attrs: {
      readonly: 'true',
      rows: '12',
      'aria-label': '生成されたプロンプト(固定文の部分)',
      placeholder: '上の「プロンプトを生成」ボタンを押すと、ここに全文が表示されます。',
    },
  });
  const outputContentTextarea = h('textarea', {
    className: 'output__textarea output__textarea--content',
    attrs: {
      readonly: 'true',
      rows: '10',
      'aria-label': '生成されたプロンプト(24行の内容部分)',
    },
  });
  const charCount = h('p', { className: 'output__char-count', text: '0文字' });

  function generatePrompt(): void {
    const prompt = buildPrompt(state.rows, state.settings);
    lastPrompt = prompt;
    const splitIndex = prompt.indexOf(CONTENT_HEADING);
    if (splitIndex === -1) {
      outputFixedTextarea.value = prompt;
      outputContentTextarea.value = '';
    } else {
      outputFixedTextarea.value = prompt.slice(0, splitIndex).replace(/\n+$/, '');
      outputContentTextarea.value = prompt.slice(splitIndex);
    }
    charCount.textContent = `${prompt.length}文字`;
  }

  const generateButton = h('button', {
    className: 'button button--primary',
    attrs: { type: 'button' },
    text: 'プロンプトを生成',
    on: { click: generatePrompt },
  });

  const copyButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: 'クリップボードにコピー',
    on: {
      click: () => {
        if (!lastPrompt) {
          showToast('先に「プロンプトを生成」を押してください。', 'error');
          return;
        }
        copyToClipboard(lastPrompt).then((ok) => {
          showToast(
            ok
              ? 'クリップボードにコピーしました。'
              : 'コピーに失敗しました。本文を選択して手動でコピーしてください。',
            ok ? 'success' : 'error',
          );
        });
      },
    },
  });

  const saveProjectButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: 'プロジェクトをJSONで保存',
    on: {
      click: () => {
        const json = serializeProject(state.rows, state.settings);
        downloadTextFile(
          `wanwan-linestamp-project_${formatTimestamp(new Date())}.json`,
          json,
          'application/json',
        );
      },
    },
  });

  const loadProjectButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: 'プロジェクトをJSONで読み込み',
    on: {
      click: () => {
        void openFilePicker('application/json').then(async (file) => {
          if (!file) {
            return;
          }
          const text = await file.text();
          const result = deserializeProject(text);
          if (!result.ok) {
            showToast(result.error, 'error');
            return;
          }
          state.rows.splice(0, state.rows.length, ...result.rows);
          Object.assign(state.settings, result.settings);
          rowsTable.refresh();
          settingsForm.refresh();
          handleChange();
          showToast('プロジェクトを読み込みました。');
        });
      },
    },
  });

  const templateButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: 'CSVテンプレートをダウンロード',
    on: {
      click: () =>
        downloadTextFile('stamp_rows_template.csv', buildCsvTemplate(), 'text/csv;charset=utf-8'),
    },
  });

  const pasteButton = h('button', {
    className: 'button',
    attrs: { type: 'button' },
    text: '表に貼り付け',
    on: { click: () => csvDialog.open() },
  });

  updateWarningBanner();

  return h('div', { className: 'prompt-view' }, [
    h('p', {
      className: 'callout',
      text: 'このプロンプトを貼るときは、参照画像もChatGPTに添付してください。プロンプト本文には画像を埋め込めません。参照画像は、元のファイルをChatGPTの入力欄にドラッグ&ドロップするのが簡単です。',
    }),

    createSectionHeading('参照画像'),
    createReferenceImageSection(state),

    createSectionHeading('24個のセリフ・状況'),
    h('div', { className: 'toolbar' }, [pasteButton, templateButton]),
    warningBanner,
    rowsTable.element,

    createSectionHeading('共通設定'),
    settingsForm.element,

    summary.element,
    h('div', { className: 'toolbar' }, [generateButton, saveProjectButton, loadProjectButton]),

    createSectionHeading('生成されたプロンプト'),
    h('div', { className: 'output__textarea-group' }, [outputFixedTextarea, outputContentTextarea]),
    h('div', { className: 'output__footer' }, [charCount, copyButton]),
  ]);
}
