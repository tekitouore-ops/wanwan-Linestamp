import './styles/main.css';
import { createPromptView } from './prompt/promptView';
import { h } from './shared/dom';
import { Store } from './shared/store';
import { createSplitView } from './split/splitView';
import { createTabs, type TabDefinition } from './ui/tabs';

type TabId = 'prompt' | 'split';

const tabs: Array<TabDefinition<TabId>> = [
  {
    id: 'prompt',
    label: '① プロンプト作成',
    render: () => createPromptView(),
  },
  {
    id: 'split',
    label: '② 画像分割・書き出し',
    render: () => createSplitView(),
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
