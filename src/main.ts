import './styles/main.css';
import { createPromptView } from './prompt/promptView';
import { h } from './shared/dom';
import { Store } from './shared/store';
import { createTabs, type TabDefinition } from './ui/tabs';

type TabId = 'prompt' | 'split';

function renderPlaceholder(message: string): HTMLElement {
  return h('div', { className: 'placeholder', text: message });
}

const tabs: Array<TabDefinition<TabId>> = [
  {
    id: 'prompt',
    label: '① プロンプト作成',
    render: () => createPromptView(),
  },
  {
    id: 'split',
    label: '② 画像分割・書き出し',
    render: () => renderPlaceholder('準備中: 画像分割・書き出しタブ(Phase 3〜4で実装予定)'),
  },
];

function main(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) {
    throw new Error('#app 要素が見つかりません。');
  }

  const header = h('header', { className: 'app-header' }, [
    h('h1', { text: 'wanwan-Linestamp' }),
    h('p', { className: 'app-header__desc', text: 'LINEスタンプ制作支援ツール' }),
  ]);
  app.append(header);

  const tabStore = new Store<TabId>('prompt');
  createTabs(app, tabs, tabStore);
}

main();
