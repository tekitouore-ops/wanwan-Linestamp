import { h } from '../shared/dom';

export interface SliderFieldOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** ダブルクリックで戻す値。 */
  defaultValue: number;
  /** ラベル末尾に添える単位表示(例: 'px', '%')。 */
  unit?: string;
  onChange: (value: number) => void;
}

export interface SliderField {
  element: HTMLElement;
  /** 外部からの値の同期(onChangeは呼ばない)。 */
  setValue: (value: number) => void;
  getValue: () => number;
}

/** ラベル+スライダー+数値入力+ダブルクリックでの初期値リセットをまとめた共通部品。 */
export function createSliderField(options: SliderFieldOptions): SliderField {
  const { label, min, max, step, defaultValue, unit, onChange } = options;

  const rangeInput = h('input', {
    className: 'slider-field__range',
    attrs: { type: 'range', min: String(min), max: String(max), step: String(step) },
  });
  const numberInput = h('input', {
    className: 'slider-field__number',
    attrs: { type: 'number', min: String(min), max: String(max), step: String(step) },
  });

  function clamp(value: number): number {
    if (Number.isNaN(value)) {
      return defaultValue;
    }
    return Math.min(max, Math.max(min, value));
  }

  function setDisplayValue(value: number): void {
    rangeInput.value = String(value);
    numberInput.value = String(value);
  }
  setDisplayValue(clamp(options.value));

  rangeInput.addEventListener('input', () => {
    const value = clamp(Number(rangeInput.value));
    numberInput.value = String(value);
    onChange(value);
  });
  numberInput.addEventListener('change', () => {
    const value = clamp(Number(numberInput.value));
    setDisplayValue(value);
    onChange(value);
  });

  function resetToDefault(): void {
    setDisplayValue(defaultValue);
    onChange(defaultValue);
  }
  rangeInput.addEventListener('dblclick', resetToDefault);
  numberInput.addEventListener('dblclick', resetToDefault);

  const labelText = unit ? `${label}(${unit})` : label;
  const labelEl = h('span', { className: 'slider-field__label', text: labelText });
  labelEl.addEventListener('dblclick', resetToDefault);

  const element = h('div', { className: 'slider-field' }, [
    labelEl,
    h('div', { className: 'slider-field__controls' }, [rangeInput, numberInput]),
  ]);

  return {
    element,
    setValue: (value: number) => setDisplayValue(clamp(value)),
    getValue: () => clamp(Number(numberInput.value)),
  };
}
