# JMA Weather Card (Unofficial) — 日本語の説明

English: [README.md](README.md)

## 概要

Home Assistant の統合 [ha-jma](https://github.com/glockpete/ha-jma) のためのダッシュボードカードです。日本のどの地点でも、天気予報・気象庁の警報・注意報・1時間先までの雨・雨雲レーダーを1枚のカードに表示します（**非公式**。気象庁が作成・承認・サポートしているものではありません）。

カードは、統合が取得した気象庁などの公開データを表示するだけです。天気のデータを自分で取得することはないので、ha-jma の統合が必要です。

> **重要。** これはコミュニティによるプロジェクトです。**避難や安全の判断に使わないでください。危険を知る唯一の手段として頼らないでください。** ダッシュボード用の便利な表示であり、警報システムではありません。

## 必要なもの

- [ha-jma](https://github.com/glockpete/ha-jma) 0.7.0 以降を、1つ以上の地点で設定済みであること
- Home Assistant 2026.9 以降
- レーダーを使うときは、ha-jma の `radar_frames` センサーを有効にしてください。全国の予報表を使うときは `japan` センサーを有効にしてください。どちらも初期状態では無効です。
- 地図のために、ブラウザーが気象庁と国土地理院のサーバー（`base_map` で別の背景地図を選んだ場合は、そのサーバー）に接続できること

## 導入

**HACS を使う場合:** HACS のメニュー（右上の3つの点）から「カスタムリポジトリ」を開き、`https://github.com/glockpete/ha-jma-card` をタイプ **Dashboard**（ダッシュボード）で追加します。「JMA Weather Card (Unofficial)」をダウンロードし、ブラウザーのページを再読み込みします。

**手動の場合:** [最新のリリース](https://github.com/glockpete/ha-jma-card/releases/latest)から `ha-jma-card.js` をダウンロードし、Home Assistant の設定フォルダーの `www`（`/config/www/`）に置きます。ダッシュボードのリソースとして URL `/local/ha-jma-card.js`、タイプ **JavaScript モジュール**（YAML では `type: module`）を追加し、ブラウザーを再読み込みします。

## 最小の設定

```yaml
type: custom:ha-jma-card
entity: weather.jma_chiyoda
```

必須なのは `entity`（ha-jma の天気エンティティ）だけです。同じデバイスにある ha-jma の他のエンティティは、カードが自動で見つけます。

## 設定項目

| キー | 型 | 初期値 | 内容 |
|---|---|---|---|
| `entity` | エンティティ ID | | **必須。** ha-jma の `weather.` エンティティ（例：`weather.jma_chiyoda`）。 |
| `mode` | `compact` / `full` | `compact` | `compact` は通常の列用。`full` はすべての項目を開いた状態で、レーダーのループ再生付き。パネルビュー向けです。 |
| `title` | 文字列 | 空 | カード内の見出し。空なら表示しません。 |
| `icon` | アイコン | 空 | 見出しの横のアイコン（例：`mdi:weather-partly-cloudy`）。`full` で `title` があるときのみ。 |
| `square` | `true` / `false` | `false` | `compact` のみ。閉じた状態で 1:1 の正方形にします。 |
| `show_radar` | `true` / `false` | `true` | `compact` のみ。`false` でレーダーのサムネイルを隠します。 |
| `base_map` | `gsi` / `osm` / `esri` / マッピング | `gsi` | レーダーの下の地図。`gsi` は国土地理院の淡色地図です。マッピング `{url, attribution, max_zoom}` で自分の https のタイルサーバーを指定できます（YAML のみ）。下の「背景地図」を参照。 |
| `navigate` | 文字列 | 空 | `compact` のみ。レーダーまたは1時間先の雨のグラフをタップしたときに開くダッシュボードのパス（例：`/lovelace/weather`）。 |
| `zoom` | 3〜16 の数 | `10` | `compact` のみ。レーダーのサムネイルの地図のズーム。 |
| `home` | `[緯度, 経度]` | 空 | レーダーの中心。空なら `radar_frames` センサーの位置、次に Home Assistant の位置。`{latitude: …, longitude: …}` も使えます。 |
| `spans` | 数のリスト（km） | `[15, 60, 250, 3000]` | `full` のみ。ズームのプリセット（レーダーの幅が何 km か）。 |
| `zoom_labels` | 文字列のリスト | `[Local, Area, Region, Japan]` | `full` のみ。各プリセットのボタンの名前。 |
| `hours` | 1〜72 の整数 | `24` | 1時間ごとの予報を何時間分並べるか。 |
| `entities` | マッピング | 空 | ha-jma のエンティティを手動で指定します。カードが見つけたものを置き換えるときだけ必要です。役割：`warnings` `rain` `frames` `overview` `feed` `quake` `outlook` `typhoon` `wbgt` `kikikuru` `rain_outlook` `japan` `tsunami` `heat_alert` `sun` |
| `lightning` | マッピング | 空 | 任意。Blitzortung の落雷表示。`distance` `azimuth` `counter`（エンティティ ID）、`source`（初期値 `blitzortung`）、`minutes`（初期値 `30`）。 |
| `alert_entity` | エンティティ ID | 空 | 任意。アラートの助言（`advice` `time` `test` `hazard` `level` `guidance` `message` の属性）を持つエンティティ。ha-jma はこのエンティティを作りません。 |

`entities` と `lightning` の下に知らないキーがあるとエラーになります。`grid_options` など Home Assistant 自身のキーはそのままにされます。

ビジュアルエディターでは `base_map` を `gsi`・`osm`・`esri` から選べます。独自のタイルサーバー（マッピング）は YAML で指定し、エディターはそれをそのまま残します。

## 背景地図

`base_map` はレーダーの下の地図を選びます。初期値は `gsi`、国土地理院（GSI）の淡色地図で、キーは要りません。カードの出典欄には、使用中の背景地図の出典だけが表示されます。

| `base_map` | タイル | 取得する最大ズーム | ラベル | カードの出典表示 | 利用規約 |
|---|---|---|---|---|---|
| `gsi`（初期値） | 地理院タイル 淡色地図 `https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png` | 18 | 地図画像に含まれる | 出典：国土地理院（地理院タイル）（タイル一覧へのリンク付き） | <https://maps.gsi.go.jp/development/ichiran.html>：アプリ上でリアルタイムに読み込む場合は申請不要で、出典の明示とこのページへのリンクが必要です。国土地理院コンテンツ利用規約：<https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html> |
| `osm` | OpenStreetMap 標準タイル `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | 19 | 地図画像に含まれる | © OpenStreetMap contributors（<https://www.openstreetmap.org/copyright> へのリンク付き） | タイル利用ポリシー <https://operations.osmfoundation.org/policies/tiles/>：提供はベストエフォートで保証はなく、大量のアクセスは認められません。 |
| `esri` | Esri World Light Gray の Base と Reference（旧版） | 16 | レーダーの上に別レイヤーで表示 | Esri, HERE, Garmin, © OpenStreetMap contributors | 利用条件の要約 <https://goto.arcgis.com/termsofuse/viewsummary>：Esri のソフトウェアを使うか、ArcGIS Online のサブスクリプションが必要です。この項目は mature support（保守のみ）の扱いで、2029年12月の終了予定のタグが付いています。 |
| マッピング | 自分のタイルサーバー | `max_zoom`（初期値 18） | 地図画像に含まれる | `attribution` の文字列。なければ `Map tiles: <ホスト名>` | タイル提供元の規約 |

- **GSI。** タイルはズーム 2〜18 です。ズーム 2〜8 は全世界、ズーム 5〜18 は日本とその周辺で、日本の外を中心にするとズーム 8 を超えた地図は空白になります。タイル一覧は出典を「国土地理院」または「地理院タイル」と書き、<https://maps.gsi.go.jp/development/ichiran.html> へのリンクを付けるよう求めており、出典表示がそれに当たります。ズーム 8 以下では、海岸線データ（Vector Map Level 0、NIMA・USGS）の表記も求められており、これは出典表示のツールチップに入っています。
- **OpenStreetMap。** `tile.openstreetmap.org` はボランティアが運営しています。軽いダッシュボードで使うか、`base_map` に自分のタイルサーバーを指定してください。
- **Esri** は、必要なライセンスをお持ちの方のために選択肢として残してあります。利用条件が Esri のソフトウェアまたは ArcGIS Online のサブスクリプションを求め、旧版の項目が終了予定のため、初期値にはしていません。
- **ラベル。** `gsi`・`osm`・独自のタイルではラベルが地図画像に含まれるため、レーダーはその上に重なります。`esri` はラベルをレーダーの上に描きます。
- **ダークテーマ。** どの背景地図もフィルターで暗くします。

独自の背景地図は YAML で指定します。

```yaml
type: custom:ha-jma-card
entity: weather.jma_chiyoda
base_map:
  url: https://tiles.example.org/{z}/{x}/{y}.png
  attribution: "© Example Tiles"
  max_zoom: 18
```

`url` は `https://` で始め、`{z}` `{x}` `{y}` を含めます。それ以外の `{…}` はエラーです。サーバーのキーはクエリ（`?key=…`）に入れられますが、`user:password@` は使えません。`attribution` はただの文字列で、省略すると `Map tiles: <ホスト名>` を表示します。`max_zoom` は 2〜22 の整数で、これを超えるときはそのズームのタイルを拡大して表示します。タイル提供元が求める出典を表示してください。

## 言語

- **気象庁の用語は日本語のまま**で、英語の説明を添えます（警報名・震度・キキクル・天気概況・週間予報の曜日）。
- **日付・時刻・数値は Home Assistant の言語とタイムゾーンに従います。** 時刻は24時間表記です。日本語側の日付（月日・曜日）は常に日本語です。
- **気温は天気エンティティの `temperature_unit`**（°C・°F・K）に従います。暑さ指数（WBGT）は常に °C です。
- カード自身のラベルは英語です。翻訳ファイルはありません。

## プライバシー

- カードにはサーバーもアカウントもありません。Home Assistant のエンティティの状態を読むだけです。
- **ブラウザーは、地図のタイルと天気のアイコンを気象庁と国土地理院のサーバーから直接読み込みます。** `base_map` を `osm`・`esri`・独自のサーバーにした場合、背景地図のタイルは国土地理院ではなくそのサーバーから読み込みます。フルモードの雷のレイヤーでは、気象庁の落雷ファイルも読み込みます。これらのサーバーには、ブラウザーのアドレスと、画面の地域を示すタイルのアドレスが見えます。
- 引き出しの開閉・タブ・レーダーのレイヤーは、ブラウザーのローカルストレージに保存されます。
- `home` を指定すると、座標がダッシュボードの設定に入ります。レーダーの中心が違うときだけ指定してください。

## 出典とライセンス

**非公式：このカードは気象庁と無関係であり、気象庁が承認したものでもありません。**

カード自体に出典が表示されます。最初の2つは、どのモードでも、データの有無にかかわらず常に表示されます。ほかは、そのデータが画面に出ている間だけ追加されます。

- **出典：気象庁ホームページ（https://www.jma.go.jp/bosai/）** と **気象庁の情報を加工して作成**（常時）。気象庁のコンテンツは、権利表記がない限り「公共データ利用規約（第1.0版）」に準拠した条件で利用できます。利用規約：<https://www.jma.go.jp/jma/kishou/info/coment.html>
- **出典：国土地理院（地理院タイル）**（地図の表示中で、`base_map` が `gsi`（初期値）のとき）。国土地理院のタイル一覧と利用条件：<https://maps.gsi.go.jp/development/ichiran.html>（出典表示はこのページへのリンクです）。
- **© OpenStreetMap contributors**（地図の表示中で、`base_map` が `osm` のとき）。タイル利用ポリシー：<https://operations.osmfoundation.org/policies/tiles/>。著作権：<https://www.openstreetmap.org/copyright>
- **Esri, HERE, Garmin, © OpenStreetMap contributors**（地図の表示中で、`base_map` が `esri` のとき）。Esri の利用条件の要約：<https://goto.arcgis.com/termsofuse/viewsummary>
- **`attribution` の文字列、またはなければ `Map tiles: <ホスト名>`**（地図の表示中で、`base_map` が独自のマッピングのとき）。タイル提供元の規約に従ってください。
- **Weather data by Open-Meteo.com**（1時間ごとの予報または体感温度の表示中）。CC BY 4.0。無料の API は非営利目的に限られます。
- **環境省 熱中症予防情報サイト**（暑さ指数のタイルまたは熱中症の行の表示中）。<https://www.wbgt.env.go.jp/en/tos.php>
- **P2P地震情報**（最新の地震または津波の行の表示中）。
- **Blitzortung.org**（`lightning.counter` に存在するエンティティを指定したとき）。
- **洪水浸水想定区域のレイヤー**は国土地理院のハザードマップのデータです。出典の表示は ha-jma の `radar_frames` センサーが送る文言で、レイヤーの凡例の下に表示されます。

各サービスの利用規約は利用者にも適用されます。カードのコードは [MIT ライセンス](LICENSE)です。

## 貢献・不具合の報告

[CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。テストは `node --test "test/*.test.cjs"` で実行します。予報や警報の値そのものの誤りは、[ha-jma](https://github.com/glockpete/ha-jma/issues) に報告してください。セキュリティ上の問題は [SECURITY.md](SECURITY.md) の方法で非公開に報告してください。
