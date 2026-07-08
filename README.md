# ｜資產紀錄 App

手機優先的 PWA：Google 登入、雲端同步（Firebase）、可加入手機主畫面當 App 用。
功能：新增/編輯資產、總資產與千萬進度、距離目標試算（需要的年/月/日報酬率）、資產變化紀錄與折線圖。

上線需要兩件事，都免費：
1. **Firebase**（負責 Google 登入＋存資料）
2. **GitHub Pages**（負責給你一個網址）

全程大約 15～20 分鐘，照下面順序做。

---

## 第 1 步：建立 Firebase 專案

1. 打開 https://console.firebase.google.com ，用你的 Google 帳號登入。
2. 點「新增專案」→ 專案名稱隨便取（例如 `networth-app`）→ Google Analytics 可以關掉 → 建立。
3. 進入專案後，點首頁中間的 **`</>`（Web）圖示** 新增網頁應用程式：
   - 暱稱隨便取，**不要**勾 Firebase Hosting。
   - 註冊後會出現一段 `const firebaseConfig = { ... }`，**先複製起來**（之後也能在「專案設定 → 一般 → 你的應用程式」找到）。

## 第 2 步：開啟 Google 登入

1. 左邊選單 →「建構」→「Authentication」→「開始使用」。
2. 「Sign-in method」→ 選「Google」→ 啟用 → 儲存。

## 第 3 步：建立 Firestore 資料庫

1. 左邊選單 →「建構」→「Firestore Database」→「建立資料庫」。
2. 位置選 `asia-east1`（台灣）→ 以「正式版模式」建立。
3. 進入「規則」分頁，整段換成下面內容後按「發布」：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

這條規則的意思：只有登入者本人能讀寫自己的資料，別人看不到。

## 第 4 步：把 Firebase 設定貼進程式

1. 打開 `index.html`，找到最上面標著 **【第 1 步：貼上你自己的 Firebase 設定】** 的區塊。
2. 把整段 `const firebaseConfig = { ... }` 換成你在第 1 步複製的那段。存檔。

## 第 5 步：上傳到 GitHub 並開啟網址

1. 到 https://github.com/new 建一個新 repo，名稱例如 `networth-app`，設為 **Public**（GitHub Pages 免費版需要）。
2. 在 repo 頁面點「uploading an existing file」，把這 5 個檔案全部拖進去上傳：
   `index.html`、`manifest.json`、`sw.js`、`icon-192.png`、`icon-512.png`
3. repo →「Settings」→ 左邊「Pages」→ Source 選 `Deploy from a branch` → Branch 選 `main`、資料夾 `/ (root)` → Save。
4. 等 1～2 分鐘，你的網址就是：
   `https://你的帳號.github.io/networth-app/`

## 第 6 步：把網址加進 Firebase 白名單（很重要，不做會登入失敗）

1. 回 Firebase →「Authentication」→「設定」→「授權網域」。
2. 點「新增網域」，加入 `你的帳號.github.io`。

## 第 7 步：手機安裝成 App

用手機瀏覽器打開你的網址：

- **iPhone（Safari）**：分享按鈕 →「加入主畫面」。
- **Android（Chrome）**：右上角選單 →「加到主畫面」或「安裝應用程式」。

打開後全螢幕、沒有網址列，就跟原生 App 一樣。

---

## 之後怎麼更新程式

改好 `index.html` 後，到 GitHub repo 直接編輯或重新上傳同名檔案，1～2 分鐘後網址就是新版。手機重新整理一次即可。

## 常見問題

- **登入按下去沒反應／跳錯誤**：九成是第 6 步授權網域沒加，或第 4 步 config 沒貼對。
- **iPhone 主畫面版登入卡住**：先用 Safari 網頁版登入一次，再從主畫面圖示開。
- **資料存在哪？**：Firebase Firestore，跟著你的 Google 帳號走，換手機、換電腦登入同一個 Google 帳號都看得到。
- **費用**：這種個人用量在 Firebase 免費額度內（每天 5 萬次讀取），不會收費。
