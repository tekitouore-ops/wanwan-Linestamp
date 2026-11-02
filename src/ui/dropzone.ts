import { h } from '../shared/dom';

export interface DropzoneOptions {
  label: string;
  hint?: string;
  onFile: (file: File) => void;
  onInvalidFile?: (message: string) => void;
}

/** ドラッグ&ドロップとクリック選択の両方に対応した、画像専用のドロップゾーン。 */
export function createDropzone(options: DropzoneOptions): HTMLElement {
  const input = h('input', {
    className: 'dropzone__input',
    attrs: { type: 'file', accept: 'image/*' },
  });

  const children: Array<Node | string> = [
    h('p', { className: 'dropzone__label', text: options.label }),
  ];
  if (options.hint) {
    children.push(h('p', { className: 'dropzone__hint', text: options.hint }));
  }
  children.push(input);

  const zone = h(
    'div',
    { className: 'dropzone', attrs: { role: 'button', tabindex: '0' } },
    children,
  );

  function handleFiles(files: FileList | null): void {
    const file = files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      options.onInvalidFile?.('画像ファイル(PNG/JPEG/WebPなど)を選択してください。');
      return;
    }
    options.onFile(file);
  }

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dropzone--active');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dropzone--active');
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dropzone--active');
    handleFiles(event.dataTransfer?.files ?? null);
  });
  input.addEventListener('change', () => {
    handleFiles(input.files);
  });

  return zone;
}
