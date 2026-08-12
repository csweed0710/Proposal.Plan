# 計畫書接案系統

整合補助情報、客戶資料、適配分析、案件問卷、AI 起草、審核修改與參考資料的接案工作台。

## 本機開發

```bash
npm ci
copy .env.example .env
npm run dev
```

正式建置與品質檢查：

```bash
npm run check
npm test
npm run build
```

## 正式環境存取保護

管理介面包含客戶聯絡資料、內部備忘與提案內容。Railway 正式環境務必設定：

```text
APP_ACCESS_USERNAME=你的管理帳號
APP_ACCESS_PASSWORD=至少 20 字元的隨機密碼
```

設定後，管理頁面與非公開 API 都會要求 HTTP Basic Auth。客戶專屬問卷 `/intake/:token`、其問卷 API 與前端靜態資產維持公開；問卷 token 本身必須保密。

若未設定 `APP_ACCESS_PASSWORD`，伺服器仍可啟動，但管理介面會保持公開並在啟動日誌顯示安全警告。

## AI 模式

```text
LLM_API_KEY=...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

沒有設定金鑰時，系統會使用規則引擎產生素材骨架。

### 提案品質閘門

每次審核除了原有的格式、評分標準、具體性、數據、表格與一致性檢查，還會執行來源追溯：

- 草稿中的量化主張必須能在客戶資料、問卷、補助公告或參考資料找到來源。
- 來源中不存在的數字會列為高嚴重度問題。
- 仍有 `【待補】`、必要章節不足或高嚴重度問題時，不會自動標示為達標。
- 系統達標只代表可以進入人工定稿，不代表可以跳過專業人員確認直接送件。

單獨執行品質閘門測試：

```bash
npm run test:proposal-quality
```

## Railway 部署

專案根目錄已有 `Dockerfile`。部署前請確認：

1. `DATABASE_URL`、`APP_ID`、`APP_SECRET` 已設定。
2. `APP_ACCESS_USERNAME`、`APP_ACCESS_PASSWORD` 已設定。
3. AI 模式需要的 `LLM_*` 變數已設定。
4. 部署完成後，以未登入瀏覽器確認管理頁回傳 `401`，並確認客戶問卷連結仍可開啟。
