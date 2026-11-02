# アーキテクチャ

## モジュール構成と依存方向

```
ui/        共通UI部品(タブ、ボタン、スライダー、トースト、ドロップゾーン等)
prompt/    機能1: プロンプト生成(types, buildPrompt, csv, projectFile, promptView)
split/     機能2前半: シート画像の自動検出・エディタ(types, mask, gridSplit, editorState, splitView)
export/    機能2後半: 規格化・書き出し(alpha, outline, layout, renderStamp, zip)
shared/    共通基盤(lineSpec, imageData, store, dom, types)
```

依存は一方向。

```
ui, prompt, split, export  →  shared
export                      →  split の型のみ参照可(bbox・エディタ結果を描画入力として使うため)
```

`prompt` と `split` は互いに依存しない。`export` は `split` の「結果の型」だけを知っていればよく、
検出アルゴリズムの実装詳細には依存しない。

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

### 機能2: 分割・書き出し

```
[シート画像ファイル] --(imageData.ts: loadImageData)--> [ImageDataLike]
[ImageDataLike] --(mask.ts: estimateBackground + buildForegroundMask)--> [前景マスク]
[前景マスク] --(gridSplit.ts: detectGrid)--> [CellBox[24]](自動検出 or 等分割フォールバック)
[CellBox[24]] --(split/editorState.ts)--> [ユーザー編集後のCellBox[24]]
[ImageDataLike] + [CellBox] + [全体設定/個別設定] --(export/renderStamp.ts)--> [規格サイズImageDataLike]
  内部: crop --> alpha.ts(背景透過) --> layout.ts(配置計算) --> outline.ts(白フチ)
[規格サイズImageDataLike] --(imageData.ts: toCanvas/toBlob)--> [PNG Blob] (プレビュー表示・個別保存)
[PNG Blob × 24] --(export/zip.ts: JSZip)--> [ZIPファイル] --> ダウンロード
[CellBox[24]] + [全体設定/個別設定] <--(JSON保存/読込)
```

## 検出アルゴリズム(mask.ts / gridSplit.ts)

### Step A: 前景マスクの作成(mask.ts)

1. **背景色推定**: 画像の外周8px幅の画素の中央値(R/G/Bそれぞれ)を背景色の既定値とする。UIでスポイト指定による上書きも可能にする。
2. **前景判定**: 各画素について、背景色とのRGB各チャンネル差の最大値が「背景判定しきい値」(既定20、1〜80)を超える場合に前景とする。
3. **ノイズ除去**: 前景マスクに対して連結成分ラベリング(BFS、再帰なし)を行い、面積が最小面積(既定: 画像面積の約0.005%)未満の成分を背景に戻す。

### Step B: グリッド境界検出(gridSplit.ts、投影法)

1. **行境界**: 前景マスクを縦方向(行ごと)に投影し、各行の前景画素数の合計を求める。`rows-1`本の行境界それぞれについて、理想位置 `i * H / rows` の ±35% の範囲内で、最も長く連続する「ほぼ空の帯」(前景画素数が閾値以下の行の連なり)を探し、その中心を境界とする。見つからない場合は、その範囲内で前景密度が最小の位置を境界とする。
2. **列境界**: 1で決めた各行の帯(行の範囲)ごとに、その帯内で横方向に同様の投影を行い、`cols-1`本の列境界を独立に求める。これにより、AI生成シートで行ごとに列位置がずれていても追従できる。
3. **フォールバック**: 1・2のいずれかで妥当な境界が求まらない場合(空の帯が全く見つからない等)、画像全体を `rows × cols` で単純等分割する。UI側で「自動(投影)/等分割」を明示的に切り替えられるようにする。

### Step C: セルごとのbbox算出

- 各セル(境界で区切られた矩形領域)内の前景画素の外接矩形を、そのスタンプの枠(bbox)とする。
- 警告フラグ: セル内に前景が無い(空)/前景がセル境界に接している(内容が分割線で切れている可能性)/面積が他セルの中央値から大きく外れる、の3種をセルごとに判定し、エディタUIで赤・黄の枠表示に反映する。

## 描画パイプライン(export/renderStamp.ts)

プレビューとZIP書き出しは同一の `renderStamp(sourceImage, box, globalSettings, rowOverride): ImageDataLike` を呼ぶ。

1. **切り出し**: 枠(bbox)に白フチ分の余白を加えた範囲を元画像から切り出す。切り出し範囲が元画像の枠外に及ぶ場合、またはセルの隣接領域にかかる場合、枠の外側は強制的に背景色として扱い、隣接スタンプの混入を防ぐ。
2. **背景透過(alpha.ts)**: 切り出し領域の外周(四辺)からBFSで背景色に近い(しきい値以内)画素をスキャンライン/キュー方式でフラッドフィルし、連結した領域だけを透明にする。色キー方式(画像全体から背景色相当を一律で抜く)ではないため、キャラクター内部の白い部分(ご飯の白など)は背景と連結していなければ保持される。エッジは指定feather幅(0〜3px)でアルファをなめらかにする。
3. **配置(layout.ts)**: 出力キャンバス(既定370×320、偶数丸め)から余白(上右下左、既定10px)を引いた内側矩形に被写体が収まる最大倍率を求め、そこに拡大率(既定1.0、0.5〜1.5)を掛け、オフセットX/Yを加えて配置する。揃えは中央/下揃えを選べる。
4. **白フチ(outline.ts)**: 出力解像度上で、被写体のアルファチャンネルを指定半径(既定6px、0〜16、0でOFF)だけ膨張させ、膨張部分(被写体の外側)を白で塗る。エッジはなめらかに処理する。
5. **解像度不足バッジ**: 実効拡大率(出力時の拡大率 ÷ 元解像度相当の基準倍率)が1.3倍を超える場合、そのスタンプに警告バッジを立てる。縮小・拡大は `imageSmoothingQuality = 'high'` を使用し、大きな縮小(1/2未満)は2段階以上に分けて行う。
6. 出力の幅・高さが奇数の場合は偶数に切り下げる(LINE規格)。

## パフォーマンス方針

- 検出処理・フラッドフィルは `Uint8Array` / `Uint8ClampedArray` を直接操作し、再帰呼び出しは使わない(BFS/スキャンライン方式でスタックオーバーフローを避ける)。
- UIの描画更新(スライダー等)はデバウンスする。
- メインスレッドでの処理が重くUIがカクつく場合は、Web Workerへのオフロードを検討する(初期実装は非Worker。docs/backlog.md参照)。
