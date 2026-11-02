/** 任意のテキストを、ブラウザのダウンロードとして保存する。 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 任意のBlobを、ブラウザのダウンロードとして保存する。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 非表示のfile inputを使い、ファイル選択ダイアログを開いて1ファイルを受け取る。 */
export function openFilePicker(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener(
      'change',
      () => {
        resolve(input.files?.[0] ?? null);
      },
      { once: true },
    );
    input.click();
  });
}
