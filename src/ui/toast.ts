import { h } from '../shared/dom';

export type ToastVariant = 'success' | 'error';

let container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (!container) {
    container = h('div', {
      className: 'toast-container',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    document.body.append(container);
  }
  return container;
}

export function showToast(message: string, variant: ToastVariant = 'success'): void {
  const toast = h('div', { className: `toast toast--${variant}`, text: message });
  getContainer().append(toast);

  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  window.setTimeout(() => {
    toast.classList.remove('toast--visible');
    window.setTimeout(() => toast.remove(), 200);
  }, 2600);
}
