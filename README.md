# Telegram Chat Lens

`Telegram Chat Lens` 是一個可直接部署為靜態網站的 Telegram 對話分析工具。使用者只要把 Telegram 匯出的單一對話 `result.json` 拖進頁面，瀏覽器就會在本機完成解析、統計與視覺化，不需要後端，也不會把聊天資料上傳到伺服器。

目前專案由單頁前端組成，整理為可部署於 Cloudflare Workers Static Assets 的結構。Cloudflare Worker 只負責提供網站靜態檔案。

Based on Telegram Chat Lens by denny0223. Licensed under the MIT License.

## 專案現況

- 純前端靜態網站，沒有 build step
- 使用瀏覽器 `Web Worker` 在背景解析大型 JSON
- 以串流方式掃描 `messages` 陣列，不一次把整份匯出檔載入記憶體
- 大型群組會限制圖表與列表輸出量，將非主要參與者彙整為「其他」
- 頁面內建 Telegram Desktop 匯出教學
- 支援拖曳或手動選取 `result.json`
- 適合分析長時間跨度、訊息量大的單一對話

## 目前提供的分析內容

- 摘要卡片：總訊息數、對話時間跨度、活躍密度、發話平衡、即時回覆節奏、重啟對話間隔
- 關係洞察：活躍時段、爆量程度、對話黏著度、重啟頻率、回覆不對稱
- 圖表與列表：每週時段熱區、回覆速度分布、月度訊息趨勢、日度訊息趨勢、熱門活躍日期
- 互動分析：每位參與者的訊息樣態比例、愛用詞彙與口頭禪候選、參與者比較、常見語詞線索、通話互動分析

## 支援的資料來源

目前以 Telegram Desktop 匯出的單一對話 JSON 為主要目標，頁面會從匯出檔內的 `messages` 陣列進行分析。

建議匯出方式：

1. 在 Telegram Desktop 開啟要分析的單一對話。
2. 點選右上角選單，選擇 `Export chat history`。
3. 格式選 `JSON`。
4. 匯出完成後，把資料夾內的 `result.json` 拖進頁面。

如果只想分析文字內容，可以不勾選媒體，匯出檔通常會更小。

## Cloudflare Workers 部署

此專案使用 Cloudflare Workers Static Assets：

- `src/index.js` 是 Cloudflare Worker 入口，只呼叫 `env.ASSETS.fetch(request)` 來提供靜態網站。
- `public/` 是要部署的靜態資源目錄。
- 不需要 KV、D1、R2、Analytics Engine 或任何資料庫。
- 不需要後端上傳端點。

部署指令：

```bash
npm run deploy
```

部署前檢查：

```bash
npm run check
```

`wrangler.jsonc` 內的 Worker name 目前是 `telegram-chat-lens`。如果你的 Cloudflare 帳號中已存在同名 Worker，可在部署前自行改名。

## 本機開發

安裝依賴：

```bash
npm install
```

啟動本機 Workers dev server：

```bash
npm run dev
```

預設可開啟：

```text
http://localhost:8787/
```

因為頁面使用 `type="module"` 與瀏覽器 `Web Worker`，請透過本機 server 預覽，不要直接雙擊 `public/index.html`。

## GitHub 自動部署建議

在 Cloudflare Dashboard 連接 GitHub repository 後，可使用：

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

這個專案沒有 build step，不需要設定 framework，也不需要把 `result.json` 放到 `public/`。

## 自訂網域

部署成功後，可以在 Cloudflare Dashboard 的 Workers & Pages -> 專案 -> Settings -> Domains & Routes 綁定自訂網域。

網站應可透過以下位置存取：

- `https://<專案名稱>.<帳號>.workers.dev/`
- 綁定後的自訂網域根路徑

## 隱私架構說明

- 所有 Telegram JSON 解析與統計都在使用者瀏覽器內完成。
- 聊天資料不會上傳到 Cloudflare Worker。
- 聊天資料不會寫入 KV、D1、R2 或其他 Cloudflare 儲存服務。
- 聊天資料不會送往第三方 API。
- 請不要把私人 `result.json`、Telegram 匯出資料夾或壓縮檔提交到 Git。
- 請不要把 `result.json` 放進 `public/`，否則它會成為可公開存取的靜態資源。

原專案保留的 `demo.json` 位於 repository 根目錄，沒有放進 `public/`，因此不會被 Workers Static Assets 部署。

## 專案中的兩種 Worker 說明

- `src/index.js`：Cloudflare Worker。部署在 Cloudflare，用來提供 `public/` 內的靜態網站檔案，不解析、不記錄、不儲存聊天資料。
- `public/worker.js`：瀏覽器 Web Worker。執行在使用者裝置中，用來解析 Telegram JSON 並回傳聚合後的統計結果給頁面。

`public/worker.js` 不是 Cloudflare Worker 入口，請不要把它改成 Cloudflare Worker 程式。

## 專案結構

- `public/index.html`: 頁面結構、上傳區與各分析面板
- `public/styles.css`: 版面與視覺樣式
- `public/app.js`: UI 邏輯、圖表渲染、互動控制
- `public/worker.js`: Telegram JSON 串流解析與聚合統計的瀏覽器 Web Worker
- `public/img/`: 匯出教學截圖
- `src/index.js`: Cloudflare Worker 靜態資源入口
- `wrangler.jsonc`: Cloudflare Workers 部署設定

## 實作說明

- 解析器會先定位 JSON 內的 `messages` 陣列，再逐筆組出訊息物件
- 統計以聚合結果為主，不保留完整訊息清單在記憶體中
- 熱門詞與口頭禪改用精確詞頻統計，中文以候選詞切分與停用詞過濾整理
- 回覆速度以雙方交替發話的時間差估算，不是語意層級的精確回覆鏈
- 首頁摘要與關係洞察優先針對個人對話設計，會強調互動節奏、重啟頻率與雙向回覆差異
- 通話分析依 Telegram 匯出中的 `phone_call` 事件與相關欄位整理

## 已知限制

- 目前主要針對 Telegram 單一對話的匯出 JSON，群組聊天的摘要指標仍以個人對話優先設計
- 若匯出格式缺少 `messages` 陣列，頁面會直接判定為不支援
- 中文詞彙分析不是完整 NLP 斷詞器，而是以前端可部署為前提的候選詞切分；遇到黏在一起的長句仍可能切得不夠理想
- 熱門詞、愛用詞與口頭禪改為精確詞頻統計，但候選詞品質仍受停用詞與切分規則影響
- 大型群組模式會優先呈現訊息數較多的成員：趨勢圖顯示前 8 位加「其他」，參與者表顯示前 80 位，個人常用詞與訊息類型顯示前 24 位
- 為避免大型匯出佔用過多記憶體，回覆速度與 session 門檻會使用有上限的樣本估算；一般規模資料仍會保留完整樣本
- 回覆速度不會排除長時間沉默，超過 1 天會落在 `>1d`
- 通話結果與時長依匯出檔提供的欄位品質而定

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
