import { h } from '../shared/dom';
import { downloadTextFile, openFilePicker } from '../shared/file';
import { createDropzone } from '../ui/dropzone';
import { showToast } from '../ui/toast';
import { buildCsvTemplate, parseRows } from './csv';
import { buildPrompt } from './buildPrompt';
import { deserializeProject, serializeProject } from './projectFile';
import {
  createEmptyRows,
  DEFAULT_PROMPT_SETTINGS,
  findIncompleteRowNumbers,
  FONT_STYLE_PRESETS,
  type FontStylePreset,
  type PromptSettings,
  type StampRow,
} from './types';

const STORAGE_KEY = 'wanwan-linestamp:prompt-state:v1';

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

function loadPersistedState(): { rows: StampRow[]; settings: PromptSettings } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const result = deserializeProject(raw);
    return result.ok ? { rows: result.rows, settings: result.settings } : null;
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

function createCheckboxField(
  labelText: string,
  initialChecked: boolean,
  onChange: (checked: boolean) => void,
  hint?: string,
): { element: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { attrs: { type: 'checkbox' } });
  input.checked = initialChecked;
  input.addEventListener('change', () => onChange(input.checked));

  const label = h('label', { className: 'checkbox-field' }, [input, ` ${labelText}`]);
  const children: Array<Node | string> = [label];
  if (hint) {
    children.push(h('p', { className: 'field__hint', text: hint }));
  }
  return { element: h('div', { className: 'field field--checkbox' }, children), input };
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

/** 24行の入力表。各セルは `state.rows` を直接書き換える(再描画せず入力中のフォーカスを保つため)。 */
function createRowsTable(state: PromptViewState, onChange: () => void): RowsTableHandle {
  type Column = 'topic' | 'situation' | 'line';
  const columns: Column[] = ['topic', 'situation', 'line'];
  const inputs: Record<Column, HTMLInputElement>[] = [];
  const tbody = h('tbody');

  for (let index = 0; index < state.rows.length; index += 1) {
    const topicInput = h('input', {
      className: 'rows-table__input',
      attrs: { type: 'text', 'aria-label': `No.${index + 1} お題` },
    });
    const situationInput = h('input', {
      className: 'rows-table__input',
      attrs: { type: 'text', 'aria-label': `No.${index + 1} 状況` },
    });
    const lineInput = h('input', {
      className: 'rows-table__input',
      attrs: { type: 'text', 'aria-label': `No.${index + 1} セリフ` },
    });
    const rowInputs: Record<Column, HTMLInputElement> = {
      topic: topicInput,
      situation: situationInput,
      line: lineInput,
    };

    topicInput.addEventListener('input', () => {
      const row = state.rows[index];
      if (row) {
        row.topic = topicInput.value;
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
    lineInput.addEventListener('input', () => {
      const row = state.rows[index];
      if (row) {
        row.line = lineInput.value;
      }
      onChange();
    });

    columns.forEach((column) => {
      rowInputs[column].addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          inputs[index + 1]?.[column].focus();
        }
      });
    });

    inputs.push(rowInputs);
    tbody.append(
      h('tr', {}, [
        h('td', { className: 'rows-table__no', text: String(index + 1) }),
        h('td', {}, [topicInput]),
        h('td', {}, [situationInput]),
        h('td', {}, [lineInput]),
      ]),
    );
  }

  const table = h('table', { className: 'rows-table' }, [
    h('thead', {}, [
      h('tr', {}, [
        h('th', { className: 'rows-table__no', text: 'No.' }),
        h('th', { text: 'お題' }),
        h('th', { text: '状況' }),
        h('th', { text: 'セリフ' }),
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
      rowInputs.topic.value = row.topic;
      rowInputs.situation.value = row.situation;
      rowInputs.line.value = row.line;
    });
  }

  return { element: h('div', { className: 'rows-table-wrapper' }, [table]), refresh };
}

interface SettingsFormHandle {
  element: HTMLElement;
  refresh: () => void;
}

function createSettingsForm(state: PromptViewState, onChange: () => void): SettingsFormHandle {
  const characterNoteInput = h('textarea', {
    attrs: { rows: '2', placeholder: '例: フランスパンのキャラクター。目は小さな点、手足は丸い' },
  });
  characterNoteInput.addEventListener('input', () => {
    state.settings.characterNote = characterNoteInput.value;
    onChange();
  });

  const fontSelect = h('select', {});
  FONT_STYLE_PRESETS.forEach((preset) => {
    fontSelect.append(h('option', { attrs: { value: preset.id }, text: preset.label }));
  });

  const fontCustomInput = h('input', {
    attrs: { type: 'text', placeholder: '例: 絵本風の優しいフォント' },
  });
  const fontCustomField = createField('書体(自由入力)', fontCustomInput);
  fontCustomInput.addEventListener('input', () => {
    state.settings.fontStyleCustom = fontCustomInput.value;
    onChange();
  });

  fontSelect.addEventListener('change', () => {
    // fontSelect の選択肢は FONT_STYLE_PRESETS からのみ生成しているため、この変換は常に安全。
    const value = fontSelect.value as FontStylePreset;
    state.settings.fontStylePreset = value;
    fontCustomField.hidden = value !== 'custom';
    onChange();
  });

  const textColorInput = h('input', { attrs: { type: 'color' } });
  textColorInput.addEventListener('input', () => {
    state.settings.textColor = textColorInput.value;
    onChange();
  });

  const textOutlineField = createCheckboxField(
    '文字に白い縁取りを付ける',
    state.settings.textOutline,
    (checked) => {
      state.settings.textOutline = checked;
      onChange();
    },
  );

  const backgroundColorInput = h('input', { attrs: { type: 'color' } });
  backgroundColorInput.addEventListener('input', () => {
    state.settings.backgroundColor = backgroundColorInput.value;
    onChange();
  });

  const whiteOutlineField = createCheckboxField(
    'プロンプトでも白フチ(ステッカー風の輪郭)の指示を入れる',
    state.settings.instructWhiteOutlineInPrompt,
    (checked) => {
      state.settings.instructWhiteOutlineInPrompt = checked;
      onChange();
    },
    '既定はOFFです。白フチは通常、タブ②の書き出し時にツール側で付与します(背景が白だと検出の邪魔になるため)。',
  );

  const additionalInstructionsInput = h('textarea', {
    attrs: { rows: '2', placeholder: '例: 影は描かない' },
  });
  additionalInstructionsInput.addEventListener('input', () => {
    state.settings.additionalInstructions = additionalInstructionsInput.value;
    onChange();
  });

  function refresh(): void {
    characterNoteInput.value = state.settings.characterNote;
    fontSelect.value = state.settings.fontStylePreset;
    fontCustomInput.value = state.settings.fontStyleCustom;
    fontCustomField.hidden = state.settings.fontStylePreset !== 'custom';
    textColorInput.value = state.settings.textColor;
    textOutlineField.input.checked = state.settings.textOutline;
    backgroundColorInput.value = state.settings.backgroundColor;
    whiteOutlineField.input.checked = state.settings.instructWhiteOutlineInPrompt;
    additionalInstructionsInput.value = state.settings.additionalInstructions;
  }
  refresh();

  const element = h('div', { className: 'settings-form' }, [
    createField('キャラクター補足(任意)', characterNoteInput),
    createField('文字の書体イメージ', fontSelect),
    fontCustomField,
    createField('文字色', textColorInput),
    textOutlineField.element,
    createField('背景色', backgroundColorInput),
    whiteOutlineField.element,
    createField('追加指示(任意)', additionalInstructionsInput),
  ]);

  return { element, refresh };
}

function createCsvDialog(onApply: (text: string) => void): { open: () => void } {
  const textarea = h('textarea', {
    className: 'csv-dialog__textarea',
    attrs: { rows: '14', placeholder: 'お題,状況,セリフ\nおはよう,朝に手を振る,やっほー\n...' },
  });

  const dialog = h('dialog', { className: 'csv-dialog' }, [
    h('h2', { text: 'CSV/TSVを貼り付け' }),
    h('p', {
      className: 'csv-dialog__hint',
      text: '列順は「お題,状況,セリフ」。ヘッダー行はあってもなくても構いません。24行を超える分は無視し、足りない分は空欄にします。',
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
        : `お題または状況が未入力の行があります(No. ${numbers.join(', ')})。未入力のままでもプロンプトは生成できます。`;
  }

  function handleChange(): void {
    updateWarningBanner();
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

  const outputTextarea = h('textarea', {
    className: 'output__textarea',
    attrs: { readonly: 'true', rows: '18', 'aria-label': '生成されたプロンプト' },
  });
  const charCount = h('p', { className: 'output__char-count', text: '0文字' });

  function generatePrompt(): void {
    const prompt = buildPrompt(state.rows, state.settings);
    outputTextarea.value = prompt;
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
        if (!outputTextarea.value) {
          showToast('先に「プロンプトを生成」を押してください。', 'error');
          return;
        }
        copyToClipboard(outputTextarea.value).then((ok) => {
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
    text: '表に貼り付け(CSV/TSV)',
    on: { click: () => csvDialog.open() },
  });

  updateWarningBanner();

  return h('div', { className: 'prompt-view' }, [
    h('p', {
      className: 'callout',
      text: 'このプロンプトを貼るときは、参照画像もChatGPTに添付してください。プロンプト本文には画像を埋め込めません。',
    }),

    createSectionHeading('参照画像'),
    createReferenceImageSection(state),

    createSectionHeading('24個のお題・状況・セリフ'),
    h('div', { className: 'toolbar' }, [pasteButton, templateButton]),
    warningBanner,
    rowsTable.element,

    createSectionHeading('共通設定'),
    settingsForm.element,

    h('div', { className: 'toolbar' }, [generateButton, saveProjectButton, loadProjectButton]),

    createSectionHeading('生成されたプロンプト'),
    outputTextarea,
    h('div', { className: 'output__footer' }, [charCount, copyButton]),
  ]);
}
