# 先從這裡開始

1. 開 `device-preview.html`，切換電腦／手機查看虛構資料介面。
2. 讀 `UPGRADE.md`，先備份現有資料，再驗證並發布 Firebase 規則。
3. 本次更新推送至原 GitHub repository 的 main 分支，等待 GitHub Pages 自動部署。
4. 等 Pages 部署成功，開正式網址確認版本 2.4.12，登入並驗收資料與共享權限。
5. iPhone 用 Safari 開正式網址 → 分享 → 加入主畫面 → 打開為網頁 App → 加入。

本次更新已完成 68 項本機測試。Firestore Emulator 測試因目前執行環境禁止綁定 localhost 連接埠而未能啟動；正式規則仍需在 Firebase Console 發布並跨帳號驗證。Safari iPhone 實機畫面仍需在正式網址上確認。詳細步驟及回退限制見 `UPGRADE.md`。
