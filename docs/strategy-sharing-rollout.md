# 策略指定分享與手動已讀（2.4.29）

此版本沿用現有 Firebase Firestore、Cloudflare Worker／D1 及 FCM，不新增付費資料服務、不升級 Firebase、不啟用付費方案。免費服務仍受供應商額度限制。

## 使用行為

- 新增或編輯策略時，在既有表單底部展開「這份策略分享給誰」。對象來自目前已儲存的策略授權名單；新策略預先勾選目前授權成員，之後可自行取消。
- 僅勾選的朋友能閱讀這份策略、查看其參與名單及收到發布／更新通知。持倉分享與策略授權仍互相獨立。
- 讀者必須按「標記已讀」；打開 App、展開策略或點通知均不會自動算已讀。已讀對應到當次策略版本。
- 作者可展開「閱讀狀態」查看已讀／未讀。新版本將所有接收者視為未讀，直到重新確認；原本參與／暫不參與的選擇保留。
- 策略內容、單篇分享撤回與已讀狀態透過即時監聽反映。名單只在策略展開時監聽；收合、切頁與登出會停止。
- 舊策略仍保持原本授權方式。編輯儲存時才原子轉移到指定對象模式；原策略 ID 與參與紀錄保留。
- 原本頁面、文字、按鈕順序及既有 CSS 維持原樣；僅新增表單中的對象選擇，以及既有參與按鈕下方的閱讀狀態。

## 資料與安全

- 既有全名單策略：`strategies/{ownerUid}/posts/{postId}`。
- 指定對象策略：`selectedStrategies/{ownerUid}/posts/{postId}`。`audienceUids` 保留作者選項；`viewerUids` 僅在發布時包含接收者，私人草稿必須為空。
- 維持兩個集合，使舊版廣泛查詢不會誤讀指定策略，也避免要求所有舊作者先執行全面遷移。修改既有策略時，以一個交易寫入指定版本並刪除舊集合副本；規則拒絕留下可廣泛閱讀的同 ID 副本。
- 新集合只使用 `viewerUids array-contains` 查詢，無須新增複合索引。
- 已讀：`strategyReads/{ownerUid}/posts/{postId}/members/{readerUid}`。使用者只能替自己寫入；作者可查閱整份名單，其他接收者只可讀自己的已讀記錄。
- 參與：原本的 `strategyParticipation/.../members` 不移動、不刪除，不因策略編輯重置。
- 通知 Worker 必須從 Firestore 讀取單篇對象，與目前有效的全域授權取交集；不信任請求自行提供的收件者。限制資料缺失或讀取失敗時不發送。
- 備份維持不攜帶分享授權；匯入仍是私人草稿，不會恢復對外分享或讀者紀錄。

## 上線順序（必要）

1. 先將本版完整 `firestore.rules` 部署到現有 Firebase 專案 `networth-app-c56c7`。保留目前已發布規則作為回復依據。不要切換為測試模式。
2. 將本版 `notification-worker/worker.js` 部署到既有 Worker `jolly-dawn-c296`；沿用現有 DB 綁定、Secret、變數及排程，不必修改 D1 schema。
3. 用已登入且獲核准的帳號呼叫 Worker `/capabilities`，應回傳 `strategyAudienceVersion: 1` 及 `strategyReadVersion: 1`。此端點為唯讀，不發送通知。
4. 確認後才將 2.4.29 前端合併至 main，由既有 GitHub Pages 部署。先部署後端、最後部署前端，避免重現「權限不足」或通知失敗。
5. 用兩個現有的測試帳號確認：勾選者可讀、未勾選者不可讀；手動已讀更新；修改後已讀重置而參與保留；撤回時接收者的策略立即消失。實際推播測試需另外取得對該測試接收者發送通知的授權。

規則更新後，舊版 App 的原有策略仍可正常使用；已轉移的指定策略需要新版 App。Service Worker 版本同步更新至 2.4.29。

## 驗證

- `npm test`：148 項，包括原有財務計算與新增的通知對象、已讀及帳號切換測試。
- `npm run test:rules`：27 項，實際 Firestore Emulator 驗證；包含指定對象、私人草稿、舊版覆寫阻擋、原子轉移、權限撤回、即時策略列表及已讀版本限制。
- 360／390／768／1440 像素操作新功能；28 個既有畫面保持相同。原有 CSS 除新增功能專屬規則外逐字一致。

## 免費盤前報價查驗

本版本尚未變更 `quotes.js` 或持倉估值公式。

- Finnhub 官方串流文件說明 real-time trade stream、成交價及成交時間戳，但未取得目前使用者免費 API key 在盤前實際可用的驗證。
- 不採用未正式記載的 `trade=true` 參數；官方支援倉庫的既有回報包含舊價、零值及時間戳不準確問題。
- Twelve Data 官方說明即時延長時段需 Pro 以上；不採用。
- Alpaca 官方 FAQ 說明免費即時資料僅 IEX；SIP 最新資料需訂閱，歷史 SIP 查詢可使用至少 15 分鐘以前的資料。此限制不等於已替本 App 驗證可用的免費即時盤前報價。

在確認可用的免費來源前，保留現有 Finnhub 報價與最後成功價格，不把一般收盤價標成盤前即時價格，也不申請試用或付費服務。

來源（查驗日：2026-10-19，Asia/Taipei）：
- https://finnhub.io/docs/api/websocket-trades
- https://github.com/finnhubio/Finnhub-API/issues/476
- https://support.twelvedata.com/en/articles/5195429-pre-post-market-data
- https://docs.alpaca.markets/us/docs/market-data-faq
