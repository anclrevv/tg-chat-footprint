# TG Chat Footprint

TG Chat Footprint 是一個隱私優先的 Telegram 對話分析工具，所有聊天資料都只在使用者瀏覽器內解析與視覺化。

中文名稱：對話足跡分析

TG Chat Footprint is an independent open-source project and is not affiliated with Telegram.

本專案為獨立開源工具，與 Telegram 官方無關。

## 主畫面截圖

截圖會在正式驗證後以匿名或合成資料產生，並放在 `docs/screenshots/`。

## 功能特色

- 匯入 Telegram Desktop 單一對話匯出的 `result.json`
- 使用瀏覽器 Web Worker 背景解析大型 JSON
- 以串流方式掃描 `messages` 陣列，不一次把整份匯出檔載入記憶體
- 聚合分析訊息趨勢、回覆節奏、活躍時段、參與者差異、詞頻、Reaction 與通話
- 自動區分單人／一對一／群組模式，群組會使用發言集中度、活躍成員排行與重啟發起者等摘要
- 回覆速度只計算同一段對話內的接話；超過對話斷點的間隔會列為對話重啟
- 大型群組圖表支援 Top 5 / 8 / 12 / 20 與「其他」，完整參與者表支援搜尋、排序與分頁
- 詞彙分析優先使用瀏覽器原生 `Intl.Segmenter`，並支援本機自訂詞典
- 原生 HTML、CSS、JavaScript，沒有 React、Vue、Vite 或其他框架
- 可部署到 Cloudflare Workers Static Assets

## 隱私設計

- 所有 Telegram JSON 解析都在使用者瀏覽器內完成
- `public/worker.js` 是 Browser Web Worker，執行在使用者裝置中
- `src/index.js` 是 Cloudflare Worker，只提供 Static Assets 與安全 headers
- 不建立 upload API
- 不使用 KV、D1、R2、Durable Objects 或後端資料庫
- 不把聊天內容寫入 `localStorage` 或 IndexedDB
- 不加入 Google Analytics、Sentry 或其他 telemetry
- 不要把 `result.json` 放進 `public/`
- 不要把私人聊天匯出檔提交到 Git

## 使用方式

1. 開啟正式網站或本機開發網站。
2. 將 Telegram 匯出的 `result.json` 拖進匯入區，或點擊選擇檔案。
3. 等待瀏覽器背景分析完成。
4. 查看總覽、時間分析、對話節奏、訊息類型、詞頻、互動與通話分析。
5. 可使用「清除分析結果」釋放目前分析狀態，再重新匯入其他檔案。
6. 可調整「對話斷點」觀察 10 分鐘、30 分鐘、1 小時與 6 小時門檻下的回覆與重啟統計。
7. 可輸入自訂詞彙，每行一個詞；詞典可保存在瀏覽器 `localStorage`，聊天內容不會保存。

## Telegram 匯出方式

1. 在 Telegram Desktop 開啟要分析的單一對話。
2. 點選右上角選單，選擇 `Export chat history`。
3. 格式選 `JSON`。
4. 如果只想分析文字內容，可以不勾選媒體，匯出檔通常會更小。
5. 匯出完成後，把資料夾內的 `result.json` 匯入本頁。

## 本機開發

```bash
npm install
npm run dev
```

預設本機網址：

```text
http://localhost:8787/
```

## 測試

```bash
npm run test
```

完整驗證：

```bash
npm run verify
```

## Cloudflare Workers 部署

部署前檢查：

```bash
npm run check
```

正式部署：

```bash
npm run deploy
```

此專案使用 Cloudflare Workers Static Assets：

- `wrangler.jsonc` 的 `assets.directory` 指向 `./public`
- `assets.binding` 為 `ASSETS`
- 不需要 KV、D1、R2 或 Analytics Engine
- 不需要 SPA fallback

## 正式網域

正式網站：

https://tg-chat-footprint.hacandrew.net/

## GitHub 自動部署

Cloudflare GitHub 自動部署建議設定：

```text
Build command:

Deploy command:
npx wrangler deploy

Root directory:
/
```

如果 Cloudflare 介面要求安裝指令，使用：

```text
npm install
```

不要啟用 GitHub Pages，正式網站使用 Cloudflare Workers。

## 專案架構

```text
public/
  index.html
  styles.css
  app.js
  worker.js
  img/
src/
  index.js
tests/
docs/
.github/
package.json
wrangler.jsonc
```

## 技術說明

`src/index.js`

- Cloudflare Worker
- 提供 Static Assets
- 附加 Content Security Policy、Referrer Policy、Permissions Policy 與 `nosniff`
- 不讀取 request body
- 不解析、不記錄、不儲存聊天資料

`public/worker.js`

- Browser Web Worker
- 在使用者裝置中解析 Telegram JSON
- 串流掃描 `messages`
- 只把聚合後的統計結果回傳主執行緒
- 不回傳完整訊息清單

分析實作：

- 對話模式以實際有效 sender 數量判斷：0-1 人為單人／特殊對話、2 人為一對一、3 人以上為群組；Telegram 原始 chat type 只作輔助資訊。
- 回覆速度只計算同一 session 內的說話者切換。超過所選 session threshold 的間隔會列入 restart interval，不再塞進 `>1d` 回覆桶。
- 預設 session threshold 為 30 分鐘，並預先計算 10 分鐘、30 分鐘、1 小時與 6 小時四組聚合統計，因此切換門檻不需要重新上傳檔案。
- 一般規模資料使用精確中位數；超過固定上限時，部分百分位數會使用固定記憶體 histogram 近似，介面會標示「精確」或「大型資料近似」。
- 中文詞彙分析優先使用 `Intl.Segmenter("zh-Hant", { granularity: "word" })`；不可用時使用內建 fallback。一般熱門詞會排除文法停用詞，語氣詞、笑聲與情緒標記會保留為語氣習慣線索。
- 自訂詞典只用於本機分析；若使用保存功能，只會保存詞典，不會保存聊天內容。
- 大型群組的圖表以 Top N 與「其他」呈現；完整參與者資料以聚合列回傳，前端搜尋、排序與分頁，不一次產生大量 DOM。
- 個人詞頻與個人訊息類型基於效能限制，仍只預先計算前 24 位活躍成員，介面會揭露此限制。
- 通話分析會分開統計有時長／缺少時長、有結果／缺少結果；平均通話時長只除以有時長的通話。

## 已知限制

- 目前支援 Telegram 匯出的對話 JSON；一對一與群組聊天會使用不同摘要方式，其他 Telegram 匯出結構可能需要重新選擇對話。
- 中文詞彙分析使用瀏覽器原生斷詞、停用詞與候選短語過濾，但專有名詞、高度口語化文字及無標點長句仍可能需要自訂詞典協助。
- 大型群組圖表會以較活躍成員與「其他」呈現；完整參與者資料可透過搜尋與分頁查看，部分個人詞頻可能依資料規模限制預先計算。
- 一般規模資料使用精確中位數；超大型資料的部分百分位數可能使用固定記憶體的串流近似演算法，介面會標示分析模式。
- 回覆速度只計算所選對話 session 內的接話，超過門檻的間隔會列入對話重啟。
- 通話分析會標示資料完整度，結果仍取決於 Telegram 匯出檔提供的欄位。

## Roadmap

- 增加更多合成測試 fixture
- 增加更多合成群組與大型資料 fixture
- 增加更多鍵盤與螢幕閱讀器驗證

## 貢獻方式

請參考 [CONTRIBUTING.md](./CONTRIBUTING.md)。

重點規則：

- 不得提交私人 Telegram 匯出檔
- fixture 必須為合成資料
- 不得加入聊天 telemetry 或遠端錯誤回報
- 修改分析演算法需附測試與定義說明

## 授權與 attribution

Based on Telegram Chat Lens by denny0223.

Licensed under the MIT License. See [LICENSE](./LICENSE).
