# MediaPipe Pose Landmarker Static HTML App

このフォルダは、HTML + CSS + JavaScript だけで動く MediaPipe Pose Landmarker Web版です。Python、Flask、Cloud Run、Dockerは使いません。

## このアプリでできること

- ブラウザで前方、側方、後方、その他の動画を任意に選択する
- 少なくとも1方向の動画が選択されていれば解析を開始する
- MediaPipe Tasks Vision Web の Pose Landmarker で姿勢ランドマークを解析する
- sample fps を指定する
- 現在処理中の方向とフレーム数を進捗表示する
- 各方向ごとにランドマーク付き動画を生成する
- 各方向ごとに座標CSVを出力する
- 各方向ごとにsummary CSV / summary JSONを出力する
- 全体summary JSON / 全体summary CSVを出力する
- 可能なブラウザではZIPで一括ダウンロードする

## 研究データの扱い

動画はサーバーへアップロードされません。選択した動画、座標データ、ランドマーク付き動画は、利用者のブラウザ内で処理されます。

ただし、GitHub PagesやNetlifyで公開したページ自体、MediaPipe Tasks Vision Web、JSZipなどのJavaScriptライブラリ、WASMファイル、モデルファイルはブラウザへ読み込まれます。研究データや個人情報を扱う場合は、公開先、アクセス制限、同意範囲、利用者の端末管理を確認してください。

## ローカルでの開き方

基本:

```text
static_html_app/index.html
```

をChromeまたはEdgeで開きます。

初回利用時は、MediaPipe Tasks Vision Web、WASM、JSZipをCDNから読み込むため、インターネット接続が必要です。動画ファイル自体はサーバーへアップロードされません。

ローカルで直接開いた場合、ブラウザの制限により `models/pose_landmarker_full.task` の自動読込に失敗することがあります。その場合は、画面の「モデルファイル（任意）」で以下を手動選択してください。

```text
static_html_app/models/pose_landmarker_full.task
```

GitHub PagesやNetlifyではHTTP(S)経由で配信されるため、通常はモデルファイルを自動読込できます。

## 4方向対応の使い方

画面には以下の4つの入力欄があります。

- 前方動画 `front`
- 側方動画 `side`
- 後方動画 `back`
- その他 `other`

各方向は任意選択です。前方だけ、側方だけ、前方+側方、4方向すべて、など必要な組み合わせで解析できます。

解析後のZIPでは、方向ごとに出力が分かれます。

```text
coordinates/front/
coordinates/side/
coordinates/back/
coordinates/other/
overlays/front/
overlays/side/
overlays/back/
overlays/other/
reports/
```

ランドマーク付き動画の例:

```text
overlays/front/front_IMG_0430_landmarked_2fps.webm
overlays/side/side_IMG_0431_landmarked_2fps.webm
overlays/back/back_IMG_0432_landmarked_2fps.webm
overlays/other/other_IMG_0433_landmarked_2fps.webm
```

## GitHub Pagesで公開する方法

1. `static_html_app` フォルダをGitHubリポジトリに入れます。
2. `index.html`, `style.css`, `app.js`, `README_STATIC_HTML.md`, `models/pose_landmarker_full.task` を含めます。
3. GitHubのリポジトリ設定で Pages を有効にします。
4. 公開対象ブランチとフォルダを選びます。
5. 公開URLを開き、数秒程度の小さい動画で動作確認します。

注意:

- `pose_landmarker_full.task` は約9MBあります。GitHubの通常ファイル制限内ですが、リポジトリサイズ管理には注意してください。
- 研究データそのものをGitHubに置かないでください。

## Netlifyで公開する方法

1. `static_html_app` フォルダをNetlifyへドラッグ&ドロップ、またはGitHub連携します。
2. ビルドコマンドは不要です。
3. Publish directory は `static_html_app` にします。
4. 公開URLで小さい動画を使って、CSV、summary、ZIP、ランドマーク付き動画を確認します。

## sample fps

- 通常確認: `2`
- 長時間動画: `0.5`〜`1`

sample fps を大きくすると処理するフレーム数が増え、解析時間、CSVサイズ、ZIPサイズ、ブラウザメモリ使用量が増えます。長時間動画ではまず `0.5`〜`1` を推奨します。

## ランドマーク付き動画がWebMになる理由

この静的HTML版は、ブラウザ標準APIの `MediaRecorder` を使ってランドマーク付き動画を生成します。ChromeやEdgeではWebMが最も安定して対応されています。一方、ブラウザだけでMP4を書き出す機能は環境差が大きく、追加ライブラリやサーバー側変換が必要になることがあります。

そのため、このアプリではランドマーク付き動画を `.webm` として保存します。ZIP内では以下に入ります。

```text
overlays/<direction>/<direction>_<元動画名>_landmarked_<sample fps>fps.webm
```

## ZIP内の構成

```text
coordinates/front/   前方動画の座標CSV
coordinates/side/    側方動画の座標CSV
coordinates/back/    後方動画の座標CSV
coordinates/other/   その他動画の座標CSV
overlays/front/      前方動画のランドマーク付きWebM動画
overlays/side/       側方動画のランドマーク付きWebM動画
overlays/back/       後方動画のランドマーク付きWebM動画
overlays/other/      その他動画のランドマーク付きWebM動画
reports/             各方向summary、全体summary、manifest
```

`reports/` には、各方向の `*_summary.csv` / `*_summary.json`、全体の `summary_all.csv` / `summary_all.json`、`manifest.json` が入ります。

## 現在の制限

- 解析速度と処理可能な動画サイズは、利用者のPC、ブラウザ、メモリ、GPU対応状況に依存します。
- ローカルで直接開く場合、モデル自動読込がブラウザ制限で失敗することがあります。
- ランドマーク付き動画の時間長は、サンプルされたフレーム列から生成される確認用動画です。元動画と完全に同じフレームレートやMP4形式を保証するものではありません。
- 大容量動画や長時間動画を安定処理したい場合は、Cloud Storage + 非同期ジョブ方式などのサーバー側設計を検討してください。

## 使用ライブラリ

- MediaPipe Tasks Vision Web: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- JSZip: https://stuk.github.io/jszip/
