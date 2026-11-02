import { h } from '../shared/dom';
import type { PreviewSettings } from './types';

const PRESET_COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: '白', hex: '#ffffff' },
  { name: '黒', hex: '#000000' },
  { name: '青', hex: '#3b82f6' },
  { name: 'ピンク', hex: '#ec4899' },
  { name: '緑', hex: '#22c55e' },
  { name: '黄', hex: '#eab308' },
];

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export interface BackgroundPickerHandle {
  element: HTMLElement;
  setValue: (value: PreviewSettings) => void;
}

/** ステップBのプレビュー確認用背景(市松/指定色)を切り替える部品。 */
export function createBackgroundPicker(
  initial: PreviewSettings,
  onChange: (value: PreviewSettings) => void,
): BackgroundPickerHandle {
  let current = initial;

  function update(next: PreviewSettings): void {
    current = next;
    syncUI();
    onChange(next);
  }

  const checkerButton = h('button', {
    className: 'button bg-picker__checker',
    attrs: { type: 'button' },
    text: '市松(透過確認)',
    on: { click: () => update({ mode: 'checker', color: current.color }) },
  });

  const presetButtons = PRESET_COLORS.map((preset) =>
    h('button', {
      className: 'bg-picker__swatch',
      attrs: { type: 'button', 'aria-label': preset.name, title: preset.name },
      on: { click: () => update({ mode: 'color', color: preset.hex }) },
    }),
  );
  presetButtons.forEach((button, i) => {
    button.style.backgroundColor = PRESET_COLORS[i]?.hex ?? '#ffffff';
  });

  const colorInput = h('input', { className: 'bg-picker__color-input', attrs: { type: 'color' } });
  colorInput.addEventListener('input', () => update({ mode: 'color', color: colorInput.value }));

  const hexInput = h('input', {
    className: 'bg-picker__hex-input',
    attrs: { type: 'text', placeholder: '#111111', 'aria-label': '背景色をHEXで指定' },
  });
  hexInput.addEventListener('change', () => {
    const value = hexInput.value.trim();
    if (HEX_PATTERN.test(value)) {
      update({ mode: 'color', color: value });
    } else {
      hexInput.value = current.color;
    }
  });

  function syncUI(): void {
    checkerButton.classList.toggle('button--active', current.mode === 'checker');
    presetButtons.forEach((button, i) => {
      const isActive = current.mode === 'color' && current.color.toLowerCase() === PRESET_COLORS[i]?.hex;
      button.classList.toggle('bg-picker__swatch--active', isActive);
    });
    colorInput.value = current.color;
    hexInput.value = current.color;
  }
  syncUI();

  const element = h('div', { className: 'bg-picker' }, [
    h('div', { className: 'toolbar' }, [checkerButton, ...presetButtons, colorInput, hexInput]),
    h('p', { className: 'field__hint', text: '確認用の表示のみです。書き出す画像は常に透過のままです。' }),
  ]);

  return {
    element,
    setValue: (value) => {
      current = value;
      syncUI();
    },
  };
}
