
# Year-End FastAPI + EXE Project — Step 2 (with Reflow)

- 前端支援：行內解密與「一鍵重排兩行制」。
- 後端 `/merge`：DRYRUN，輸出 ZIP（summary + log）。

使用步驟：
1) 啟動 uvicorn 後開啟頁面。
2) 貼上加密文字、輸入密碼 → 按「解密並更新預覽」。
3) 若原始資料混雜（同一行含 token 與中文），按「一鍵重排」形成兩行制（每位學生兩行）。
4) （可選）填 `folder_path`。
5) 按「送出到 /merge」下載 ZIP。
