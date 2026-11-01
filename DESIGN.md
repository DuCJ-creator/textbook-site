---
version: alpha
name: "Shirley Du 高中英文充電站"
description: "以玻璃書房為意象的雙語高中英文教材入口，結合實體書封、學習工具箱與霧面玻璃展示櫃。"
colors:
  primary: "#276749"
  paper: "#fffdf8"
  ink: "#19231d"
  ink-soft: "#657169"
  accent: "#276749"
  accent-dark: "#174d35"
  accent-soft: "#e8f3ec"
  gold: "#e9b949"
  gold-soft: "#fff4cf"
  glass: "rgba(255, 255, 255, 0.64)"
typography:
  display:
    fontFamily: "Georgia, 'Times New Roman', 'Noto Serif TC', serif"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans TC', sans-serif"
  utility:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
rounded:
  DEFAULT: "1.25rem"
  control: "0.8125rem"
  glass-panel: "2rem"
  book-cover: "1.5rem"
spacing:
  page-max: "73.75rem"
  section-gap: "3.25rem"
  card-gap: "0.75rem"
components:
  book-cover: {}
  tool-tray: {}
  resource-card: {}
  glass-panel: {}
---

# Shirley Du 高中英文充電站 Design System

## Overview

### Creative North Star

介面是一間明亮的「玻璃書房」：課本像真正可以拿起來翻閱的精裝書，跨課工具收在有把手的學習工具箱，延伸資源則陳列在霧面玻璃展示櫃中。材質感服務於教材的分類與可辨識性，不作純裝飾。

### Product context and register

- **Audience and primary job:** 台灣高中生快速回到指定冊次、課次與跨課練習工具；教師亦可進入管理入口。
- **Target market and evidence:** 由 `zh-TW` 介面、學測題型與現有繁體中文教材內容確認為台灣高中英文學習情境。
- **Locale and language policy:** 繁體中文為導覽主語言，英語保留於教材名稱、工具分類與學習術語；不翻譯專有教材標題。
- **Usage scene:** 課堂補充與課後複習，需同時支援桌機投影、筆電與學生手機。
- **Register:** 混合型；首頁允許具記憶點的品牌表現，課文與練習頁維持安靜、熟悉的產品介面。
- **Memorable signature:** 冊次選擇以五本不同墨色的立體書封呈現，展開後連接課次書架。
- **Restraint:** 工具與資源卡片只使用一層玻璃、一層陰影與明確標籤，不堆疊無功能的裝飾。
- **Anti-references:** 不做遊戲商店式霓虹面板、不做過度擬真的木紋書架，也不使用無差異的白色 SaaS 卡片牆。
- **Token ownership/runtime mapping:** 既有 `css/style.css` 的 `:root` 為全站執行時 token 的權威來源；本文件鏡映已接受的全站值。首頁新增材質 token 暫由 `index.html` 的 `body.home-page` 管理，避免影響課文頁。

## Colors

`accent` 與 `accent-dark` 是品牌、連結與主要互動色；`gold` 僅用於進度、焦點與少量黃銅細節。`paper` 提供紙張底色，`glass` 只用於首頁群組容器，不可取代需要高對比閱讀的正文表面。文字使用 `ink` 與 `ink-soft`，不可直接以低透明白色承載長段文字。

## Typography

Georgia / Noto Serif TC 組合用於品牌、書封與內容標題，營造教材與紙本的連結；Inter / Segoe UI / Noto Sans TC 用於控制、說明與資料。中英混排避免斜體，繁體中文正文維持足夠行高；小型 utility 標籤可使用等寬字，但必須附有可讀的標題。

## Layout

首頁最大寬度為 `73.75rem`。桌面書封五欄、工具三欄、模擬資源四欄；中尺寸逐步降為三欄或二欄，手機書封保留兩欄以維持「一排書」印象，展開內容則回到單欄。群組間距使用 `section-gap`，互動展開不得造成水平溢位。

## Elevation & Depth

玻璃面板使用半透明白、20–24px 模糊、細白邊與單一柔和綠影。書封可使用較深陰影與左側書脊；一般教材內容卡不可套用同等強度。強制色彩模式移除材質依賴，保留實體邊框。

## Shapes

書封採左側較方、右側較圓的不對稱形狀；工具抽屜使用 18px 圓角；主要玻璃容器使用 32px 圓角。圓形只保留給進入箭頭、狀態點與小型 icon 容器。

## Components

### Foundational visual states

可點擊元素必須具備 hover、active 與 `focus-visible`。鍵盤焦點固定為黃銅色 3px 外框並與元件留白；禁用狀態降低對比且不保留 hover 位移。所有動態在 `prefers-reduced-motion` 下縮短為近乎即時。

### Buttons and actions

主要操作使用墨綠實色或深色玻璃，次要操作使用透明玻璃與細邊框。箭頭只輔助方向，不取代文字標籤。

### Navigation and data display

冊次書封是 disclosure button，一次只展開一本並同步 `aria-expanded`。課次清單在展開區內維持明確的已上架與尚未上架狀態。

### Forms and overlays

登入入口延續既有高對比白色卡片與原生欄位行為；學校與班級選擇明確採用瀏覽器原生 Select/Listbox，以保留各裝置熟悉的鍵盤與觸控操作。表單由應用程式處理驗證與錯誤訊息，不把玻璃透明度帶入輸入欄位正文區。

### Iconography

首頁工具採文字型功能標記（Aa、Phr、S+V）配合完整標題，避免來源不一致的 emoji。品牌既有 emoji 可保留於入口與學習花園。

### Motion

書封 hover 僅做小幅上移與輕微 Y 軸翻頁暗示；卡片 hover 小於 5px。展開狀態由原生版面流承接，不使用持續漂浮或背景粒子。

### Content and data visualization

導覽文案使用清楚、直接的繁體中文；英文用於教材名稱與短分類。進度必須同時有文字數字，不以色條單獨表意。

## Do's and Don'ts

- **Do:** 用書封、工具箱與展示櫃對應真實內容分類。
- **Do:** 新增首頁卡片時沿用現有 glass panel 與 focus 規則。
- **Don't:** 對所有白色表面加 blur，正文閱讀區保持穩定不透明。
- **Don't:** 用多重漸層、強發光或無限動畫稀釋書封這個唯一的視覺主角。
