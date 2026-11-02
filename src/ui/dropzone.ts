import { h } from '../shared/dom';

export interface DropzoneOptions {
  label: string;
  hint?: string;
  /** trueのとき、複数ファイルの選択・ドロップを許可し `onFiles` を呼ぶ。既定はfalse(`onFile` のみ)。 */
  multiple?: boolean;
  onFile?: (file: File) => void;
  /** `multiple: true` のときに呼ばれる。画像以外のファイルは除外済み。 */
  onFiles?: (files: File[]) => void;
  onInvalidFile?: (message: string) => void;
}

/** ドラッグ&ドロップとクリック選択の両方に対応した、画像専用のドロップゾーン。 */
export function createDropzone(options: DropzoneOptions): HTMLElement {
  const input = h('input', {
    className: 'dropzone__input',
    attrs: {
      type: 'file',
      accept: 'image/*',
      ...(options.multiple ? { multiple: 'multiple' } : {}),
    },
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
    const list = Array.from(files ?? []);
    if (list.length === 0) {
      return;
    }
    const validFiles = list.filter((file) => file.type.startsWith('image/'));
    if (validFiles.length < list.length) {
      options.onInvalidFile?.('画像ファイル(PNG/JPEG/WebPなど)以外は無視しました。');
    }
    if (validFiles.length === 0) {
      return;
    }
    if (options.multiple) {
      options.onFiles?.(validFiles);
    } else {
      options.onFile?.(validFiles[0] as File);
    }
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
