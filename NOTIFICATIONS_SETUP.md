# 手機推播通知部署

本功能使用 Firebase Cloud Messaging 發送推播，Cloudflare Worker + D1 負責免費方案可承載的 API 與每日排程。Firebase 保持 Spark 免費方案，不需要把 Firebase 專案升級到 Blaze。推播會盡力送達；手機勿擾、瀏覽器權限、網路與作業系統省電設定仍可能影響顯示。

## 功能

- 已分享策略的新增或更新：通知目前策略授權名單中，且自行啟用策略通知的裝置。
- 每日台灣時間 20:00：提醒當天尚未開啟 App、且開啟每日提醒的使用者（任一裝置開啟後就不會重複提醒）。
- 使用者可在 App「設定 → 手機通知」啟用、關閉此裝置，或單獨關閉任一類通知。
- 推播只送標題、標的名稱與 App 頁面連結，不送持倉金額或 API 金鑰。

## 先備資料

1. Firebase Console → 專案設定 → Cloud Messaging → Web Push 憑證，建立或複製 VAPID 公開金鑰。
2. Google Cloud Console → IAM 與管理 → 服務帳戶，建立專用服務帳戶，授予 **Firebase Cloud Messaging API Admin** 與 **Cloud Datastore Viewer** 角色並建立 JSON 金鑰。Worker 會用唯讀權限確認收件人仍有 App 授權。此 JSON 私密金鑰只放在 Cloudflare Worker Secret，絕不可放進 GitHub 或傳給其他使用者。
3. Cloudflare 帳號。Firebase Cloud Messaging API 必須已啟用。

## Cloudflare Worker 與 D1

1. Cloudflare → Workers & Pages → 建立 Worker，名稱使用 `wealth-tracker-notifications`，部署 `notification-worker/worker.js`。
2. 建立 D1 資料庫 `wealth-tracker-notifications`，在 D1 Console 執行 `notification-worker/schema.sql`。
3. Worker → Settings → Bindings 新增 D1 database binding，變數名稱填 **DB**，並選取剛建立的資料庫。
4. Worker → Settings → Variables and Secrets 新增：
   - `FIREBASE_PROJECT_ID`：`networth-app-c56c7`
   - `FIREBASE_API_KEY`：Firebase 專案的 Web API key（公開設定值）
   - `APP_ORIGIN`：正式網站的來源網域，只填 `https://...`，不要加路徑或最後的斜線
   - Secret `FCM_SERVICE_ACCOUNT`：服務帳戶 JSON 的完整內容
5. Worker → Triggers → Cron Triggers 新增 `0 12 * * *`（UTC 12:00，即台灣 20:00）。
6. 部署後記下 Worker 網址，例如 `https://wealth-tracker-notifications.<你的 Cloudflare 子網域>.workers.dev`。

## App 前端設定

在 `config.js` 設定以下兩項，再提交 GitHub 讓 Pages 部署：

```js
export const NOTIFICATION_WORKER_URL = "https://<你的 Worker 網址>";
export const FIREBASE_VAPID_KEY = "<Firebase Cloud Messaging 的 VAPID 公開金鑰>";
```

這兩項是公開連線設定，不是私密服務帳戶金鑰。部署完成後，用正式網站登入，在「設定 → 手機通知」按「啟用手機通知」，並在系統提示時允許通知。

## 手機限制

- iPhone／iPad：用 Safari 將正式網站「加入主畫面」，從主畫面圖示開啟 App，再由 App 內按「啟用手機通知」接受系統提示。一般 Safari 分頁或 Chrome iOS 分頁不能提供主畫面 Web App 的完整推播體驗。
- Android：使用 Chrome 安裝或加入主畫面，允許通知。
- 關閉通知權限後，可在手機系統設定重新允許；如果網站推播 Token 已失效，請回 App 設定重新啟用。

## 安全與維護

- 不要把服務帳戶 JSON、私密金鑰或 FCM OAuth Token 放入 `config.js`、GitHub、聊天訊息或 App。
- Worker 驗證 Firebase 登入身分與 App 使用授權；策略事件再向 Firestore 讀取最新策略和分享名單，客戶端不能自行指定收件者。
- Cloudflare、Google 與 Apple 的免費額度、產品介面及裝置限制可能調整；使用前請在各自管理主控台確認目前方案。

