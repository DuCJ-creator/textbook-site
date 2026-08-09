# 自動同步設定說明

這個專案會透過 GitHub Actions **自動**把你在 Google Sheets 上的內容同步到網站，
你只需要維護 Google Sheets，其餘全自動完成。

## 運作方式

```
你編輯 Google Sheets
      ↓（最多等 30 分鐘，或手動觸發立即執行）
GitHub Actions 自動執行 scripts/sync_from_sheets.py
      ↓
自動把更新後的 data/*.json commit 並 push 回 repo
      ↓
GitHub Pages 自動偵測到 repo 變動，重新部署網站
      ↓
學生打開網站看到最新內容
```

全程不需要你手動跑腳本、手動 commit、手動 push。

## 首次啟用步驟（只需要做一次）

1. 把整個專案（含 `.github/workflows/sync-sheets.yml`）push 到你的 GitHub repo。
2. 到 repo 的 **Settings → Actions → General**，確認「Workflow permissions」設定為
   **"Read and write permissions"**（預設可能是唯讀，這樣自動 commit 會失敗）。
3. 到 repo 的 **Actions** 分頁，你會看到 "Sync course data from Google Sheets" 這個 workflow。
   點進去、點右上角 **"Run workflow"** 手動觸發一次，確認能成功執行、成功 commit。
4. 之後它會照排程（預設每 30 分鐘）自動執行，你不用再管它。

## 你之後唯一要做的事

**編輯 Google Sheets**。就這樣。改完之後：

- 想立刻看到網站更新 → 到 repo 的 Actions 分頁手動點一次 "Run workflow"
- 不急的話 → 最多等 30 分鐘，會自動同步

## 新增課程時的行為（全自動）

當你在 Google Sheets 裡新增一個之前沒出現過的 book/lesson 組合時（例如第一次填入 B1L4 的資料），
同步腳本會自動：

1. 在 `data/b1/l4.json` 建立檔案
2. 只要五個資料來源（單字/片語/文法/句型/課文體裁）**任一**已經有內容，就自動把該課設為
   `published`，讓學生在網站上看到——**你不需要手動編輯任何 json 檔案**
3. 自動更新首頁的課程清單（`data/index.json`）

這是刻意選擇的最寬鬆策略：你只要開始在 Sheets 裡填某一課的任何一部分，
它就會出現在網站上。因為只有你自己會維護這些 Sheets，不會有「內容還沒
準備好就被別人看到」的風險。

如果之後想幫某一課補上課名，直接編輯 `data/{book}/{lesson}.json` 裡的
`title` 欄位即可，下次自動同步不會覆蓋你手動填的課名（腳本只在**新建立**
課程時 title 留空，不會動到已存在課程的 title）。

## 冊次骨架設定

`data/book_structure.json` 定義了整個課程架構有幾冊、每冊幾課
（目前是 5 冊，第 1-4 冊各 9 課、第 5 冊 6 課）。即使某冊/某課還沒有
任何 Sheets 資料，首頁仍會依這份骨架顯示對應數量的「尚未上架」佔位項目，
讓學生看到完整架構。

這份檔案**不會**被同步腳本自動修改，是你唯一還需要手動維護的設定——
但只有在你要調整冊數、課數這種架構層級的變動時才需要碰它（例如未來
決定某一冊要拆成 10 課），日常使用完全不用管。

## 排程頻率調整

預設是每 30 分鐘檢查一次。如果想改成更頻繁或更寬鬆，編輯
`.github/workflows/sync-sheets.yml` 裡的這一行：

```yaml
schedule:
  - cron: "*/30 * * * *"   # 目前：每 30 分鐘
```

例如改成 `"0 * * * *"` 是每小時整點一次；`"*/10 * * * *"` 是每 10 分鐘一次
（注意：GitHub 對免費帳號的排程執行有其調度限制，實際間隔可能略有延遲，
且排程頻率越高消耗的 Actions 分鐘數也越多，但這個同步腳本執行很快，
一般使用量不會超出 GitHub 免費額度）。

## 疑難排解

- **Actions 分頁顯示紅色 ✗ 失敗**：點進去看 log。最常見原因是 Google Sheets
  的發布連結失效（例如你不小心把某份 Sheet 取消「發布到網路」），或
  Sheets 的欄位被改動導致格式不符（腳本假設的欄位順序見
  `scripts/sync_from_sheets.py` 開頭的說明）。
- **改了 Sheets 但網站沒更新**：先確認 Actions 有沒有成功跑完並 commit
  （看 repo 的 commit 紀錄，自動 commit 訊息會是
  `chore: sync course data from Google Sheets [automated]`）；
  如果 commit 了但網站沒變，可能是 GitHub Pages 部署還在處理中，
  通常 1-2 分鐘內會完成。
