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
- 大型群組會限制圖表與列表輸出量，並將非主要參與者彙整為「其他」
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

- 回覆速度以雙方交替發話的時間差估算，不是語意層級的精確回覆鏈
- 中文詞彙分析以前端可部署為前提，使用候選詞切分與停用詞過濾
- 大型群組模式會限制趨勢圖、參與者表與語言分析輸出量
- 通話分析依 Telegram 匯出中的 `phone_call` 事件與相關欄位整理

## 已知限制

- 目前主要針對 Telegram 單一對話匯出 JSON
- 群組聊天的部分摘要指標仍以個人對話視角設計
- 若匯出格式缺少 `messages` 陣列，頁面會判定為不支援
- 中文詞彙分析不是完整 NLP 斷詞器
- 回覆速度不會排除長時間沉默，超過 1 天會落在 `>1d`
- 通話結果與時長依匯出檔提供的欄位品質而定

## Roadmap

- 增加更多合成測試 fixture
- 改善大型群組的摘要文字
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
