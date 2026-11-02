# アーキテクチャ

## モジュール構成と依存方向

```
ui/        共通UI部品(タブ、ボタン、スライダー、トースト、ドロップゾーン等)
prompt/    機能1: プロンプト生成(types, layoutConstants, fixedText, buildPrompt, csv,
           projectFile, promptView)
split/     機能2前半: 検出・編集・ステップA/B画面(types, mask, gridSplit, editorState,
           splitView, detectView, previewView, stampCard, adjustPanel, backgroundPicker)
export/    機能2後半: 規格化・書き出し(alpha, edge, outline, layout, renderStamp,
           coverImages, validate, zip)
shared/    共通基盤(lineSpec, imageData, store, dom, file, types)
```

依存は一方向。

```
ui, prompt, split, export  →  shared
export                      →  split の型のみ参照可(Rect・StampAdjust等を描画入力として使うため)
```

`prompt` と `split` は互いに依存しない。`export` は `split` の「結果の型」だけを知っていればよく、
検出アルゴリズムやUIの実装詳細には依存しない。

## タブ②の画面構成(2026-11-02改訂)

タブ②は、同じ画面内で行き来する2ステップで構成する(`split/splitView.ts` が両ステップの表示切替を担う)。

- **ステップA**(`split/detectView.ts`): シート画像の読み込み・自動検出・枠編集。「この枠で確定」でステップBへ。
- **ステップB**(`split/previewView.ts` が全体レイアウトを担当):
  - 左: 調整パネル(`split/adjustPanel.ts`、選択中の1枚の個別設定+折りたたみ式の全体設定)
  - 右: カードグリッド(`split/stampCard.ts` を24個並べる)+上部バー(`split/backgroundPicker.ts` の確認用背景切替、ZIP書き出しボタン)
  - ステップBから「枠を修正」でステップAへ戻れる。戻っても、枠を変えていないスタンプの個別設定(`ProjectState.stamps`)は保持する。

## データフロー(テキスト図)

### 機能1: プロンプト生成

```
[参照画像ファイル] --(ui/dropzone)--> [メモリ上のプレビューURL]
[24行の表入力] / [CSV貼り付け] --(csv.ts: parseRows)--> [StampRow[]]
[共通設定フォーム] --> [PromptSettings]
[StampRow[]] + [PromptSettings] --(buildPrompt.ts: buildPrompt)--> [プロンプト文字列]
[プロンプト文字列] --(ui: コピー)--> [クリップボード]
[StampRow[]] + [PromptSettings] <--(projectFile.ts)--> [JSONファイル]
[StampRow[]] + [PromptSettings] <--(localStorage自動保存)
```

### 機能2: 画像分割・書き出し

```
[シート画像ファイル] --(imageData.ts: loadImageData)--> [ImageDataLike]
[ImageDataLike] --(mask.ts: estimateBackground + buildForegroundMask)--> [前景マスク]
[前景マスク] --(gridSplit.ts: detectGrid)--> [Rect[24]](自動検出 or 等分割フォールバック)
[Rect[24]] --(split/editorState.ts: ステップAの枠編集)--> [確定したframes: Rect[24]]
[frames] --(「この枠で確定」)--> [ProjectState { frames, globalSettings, stamps: [], coverIndex: 0, preview }]

[ImageDataLike] + [Rect] + [GlobalSettings] + [StampAdjust] --(export/renderStamp.ts)--> [規格サイズImageDataLike]
  内部: crop(切り抜き適用+強制背景) --> alpha.ts(背景透過) --> edge.ts(縁補正)
        --> layout.ts(配置計算・リサイズ) --> outline.ts(縁フチ、出力解像度で適用)

[規格サイズImageDataLike] --(imageData.ts: toCanvas/toBlob)--> [PNG Blob]
  (stampCard.tsのプレビュー・容量表示、個別保存に使用)
[表紙のStampAdjust] --(export/coverImages.ts)--> [main.png用ImageDataLike, tab.png用ImageDataLike]
[PNG Blob × 24 + main.png + tab.png] --(export/zip.ts: JSZip)--> [ZIPファイル] --> ダウンロード
[ProjectState] <--(JSON保存/読込。画像本体は含めず、読込時はシート画像の再選択を求める)
```

## 検出アルゴリズム(mask.ts / gridSplit.ts)

### Step A: 前景マスクの作成(mask.ts)

1. **背景色推定**: 画像の外周8px幅の画素の中央値(R/G/Bそれぞれ)を背景色の既定値とする。ステップAの画面でスポイト指定による上書きも可能にする。
2. **前景判定**: 各画素について、背景色とのRGB各チャンネル差の最大値が「背景判定しきい値」(既定20、1〜80)を超える場合に前景とする。
3. **ノイズ除去**: 前景マスクに対して連結成分ラベリング(BFS、再帰なし)を行い、面積が最小面積(既定: 画像面積の約0.005%)未満の成分を背景に戻す。

### Step B: グリッド境界検出(gridSplit.ts、投影法)

1. **行境界**: 前景マスクを縦方向(行ごと)に投影し、各行の前景画素数の合計を求める。`rows-1`本の行境界それぞれについて、理想位置 `i * H / rows` の ±35%(1マスサイズに対する割合。docs/decisions.md参照)の範囲内で、最も長く連続する「ほぼ空の帯」(前景画素数が閾値以下の行の連なり)を探し、その中心を境界とする。見つからない場合は、その範囲内で前景密度が最小の位置を境界とする。
2. **列境界**: 1で決めた各行の帯(行の範囲)ごとに、その帯内で横方向に同様の投影を行い、`cols-1`本の列境界を独立に求める。これにより、AI生成シートで行ごとに列位置がずれていても追従できる。
3. **フォールバック**: 1・2のいずれかで妥当な境界が求まらない場合(空の帯が全く見つからない等)、画像全体を `rows × cols` で単純等分割する。UI側で「自動(投影)/等分割」を明示的に切り替えられるようにする。

### Step C: セルごとのRect算出

- 各セル(境界で区切られた矩形領域)内の前景画素の外接矩形を、そのスタンプの枠(`Rect`)とする。
- 警告フラグ: セル内に前景が無い(空)/前景がセル境界に接している(内容が分割線で切れている可能性)/面積が他セルの中央値から大きく外れる、の3種をセルごとに判定し、ステップAのUIで赤・黄の枠表示に反映する。

## 描画パイプライン(export/renderStamp.ts)

プレビュー(`stampCard.ts`)とZIP書き出しは同一の
`renderStamp(sourceImage, frame: Rect, globalSettings: GlobalSettings, adjust: StampAdjust): ImageDataLike`
を呼ぶ。

1. **枠の切り出し**: 検出枠(`Rect`)に `StampAdjust.crop`(上右下左、元画像px)を適用した範囲を決め、縁フチ・縁補正の処理余白を加えて元画像から切り出す。切り出し範囲が元画像の外、または切り抜き後の範囲の外に及ぶ場合、その部分は強制的に背景色として扱い、隣接スタンプの混入を防ぐ。
2. **背景透過(alpha.ts)**: 切り出し領域の外周(四辺)からBFSで背景色に近い(しきい値以内)画素をキュー方式でフラッドフィルし、連結した領域だけを透明にする。色キー方式(画像全体から背景色相当を一律で抜く)ではないため、キャラクター内部の白い部分(ご飯の白など)は背景と連結していなければ保持される。エッジは指定feather幅(0〜3px)でアルファをなめらかにする。
3. **縁補正(edge.ts)**: `StampAdjust.edgeFix` に応じて、アルファチャンネルをBFS距離ベースで収縮(正の値、背景除去後の白いハロ等を削る)または膨張(負の値、削りすぎを戻す)する。
4. **配置(layout.ts)**: 出力キャンバス(既定370×320、偶数丸め)から内側余白(既定10px)を引いた安全領域に、切り抜き後の被写体(縁補正込み)が収まる最大倍率を100%とする。そこに `StampAdjust.scale`(既定100%)を掛け、`offsetX`/`offsetY` を加えて配置する。揃えは中央/下揃え。安全領域やキャンバスをはみ出す場合もクランプはしないが、キャンバス外に出て切れる場合はカードに警告を出す。
5. **縁フチ(outline.ts)**: 配置(リサイズ)後、出力解像度上で被写体のアルファチャンネルを指定半径(既定は全体設定の既定値、0〜16、0でOFF)だけ膨張させ、膨張部分(被写体の外側)を白で塗る。エッジはなめらかに処理する。
   - **実装上の判断**: 指示書の記述順では「縁フチ→配置」だが、縁フチの説明文に「出力解像度で処理する」とあるため、配置(リサイズ)より後に適用する(配置前に適用すると、フチ幅が拡大率に応じて変わってしまい矛盾するため)。docs/decisions.md参照。
6. **解像度不足バッジ**: 実効拡大率(配置時の最終倍率)が1.3倍を超える場合、そのスタンプに警告バッジを立てる。縮小・拡大は `imageSmoothingQuality = 'high'` を使用し、大きな縮小(1/2未満)は2段階以上に分けて行う。
7. 出力の幅・高さが奇数の場合は偶数に切り下げる(LINE規格)。

### 表紙画像(export/coverImages.ts)

表紙に設定したスタンプ(`ProjectState.coverIndex`)の `StampAdjust` を引き継ぎ、`renderStamp` と同じパイプラインを
出力サイズだけ `main.png`(240×240)・`tab.png`(96×74)に差し替えて実行する。内側余白は、通常スタンプと同じ
比率(出力サイズに対する割合)を使う。

## パフォーマンス方針

- 検出処理・フラッドフィル・縁補正・縁フチは `Uint8Array` / `Uint8ClampedArray` を直接操作し、再帰呼び出しは使わない(BFS/スキャンライン方式でスタックオーバーフローを避ける)。
- ステップBでスライダーを操作している間は、選択中の1枚のカードだけを即時に再描画する(`requestAnimationFrame`+デバウンスで間引く)。全体設定を変更した場合のみ、24枚すべてを再描画する。
- PNG容量(KB表示)は、操作が止まってから(デバウンス約300ms)非同期で算出する。
- メインスレッドでの処理が重くUIがカクつく場合は、Web Workerへのオフロードを検討する(初期実装は非Worker。docs/backlog.md参照)。
