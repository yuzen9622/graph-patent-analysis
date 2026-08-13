# 資料庫備份與災難復原（資訊安全版）

本專案（wang / graph-patent-analysis）的資料庫安全備份方案，設計目標為 **Ubuntu 虛擬機 + Docker Compose** 部署環境。

## 架構總覽

```
                    ┌─────────────────────────────────────────────┐
  systemd timer     │  scripts/backup.sh（每日 02:10）             │
  (每日 / 每週)     │                                             │
                    │  ① pg_dump -Fc（最小權限角色 backup_user）   │
                    │  ② app data tar（上傳 Excel/JSON）          │
                    │  ③ .env（還原所需設定）                     │
                    │  ④ tar → gpg AES-256 加密                   │
                    │  ⑤ sha256 指紋                              │
                    │  ⑥ 分層保留 daily 7 / weekly 4 / monthly 6  │
                    │  ⑦ rclone → 異地 object storage（選用）     │
                    └─────────────────────────────────────────────┘
                                          │
              ┌───────────────────────────┴──────────────────────────┐
              ▼                                                     ▼
   /var/backups/wang/{daily,weekly,monthly}               異地雲端（SSE 加密）
   （gpg 加密檔 + sha256，root-only）                    （與主機同加密，雙保險）

  scripts/restore-test.sh（每週日 03:10）→ 解密 → 還原至暫存 DB → 比對驗證 → 清理
```

## 資安設計 → 對照表

| 資訊安全要求 | 本方案做法 | 對應檔案/位置 |
| --- | --- | --- |
| 靜態資料加密（機密性） | gpg AES-256 對稱加密，金鑰檔 root-only (600) | `scripts/backup.sh`、`/etc/wang-backup/backup.key` |
| 金鑰與資料分離 | 金鑰只存在主機 `/etc/wang-backup/`，**另存一份到密碼管理器**；主機毀損時才能解密 | `scripts/setup-backup.sh` 步驟 2 |
| 最小權限 | 專用 `backup_user` 角色：僅 `CONNECT + SELECT`，**無任何寫入權限**；pg_dump 用此角色 | `scripts/lib/backup-common.sh` |
| 完整性 / 防竄改 | 每份加密備份附 sha256 指紋；還原測試先驗指紋再解密 | `*.sha256`、`scripts/restore-test.sh` |
| 存取控制 | 備份目錄與設定檔 root-only（700/600）；.env 不入版控 | `setup-backup.sh` |
| 傳輸加密 | rclone over HTTPS / SSH（object storage 建議啟用 SSE） | `RCLONE_REMOTE` |
| 保留政策 | daily 7 天 / weekly 4 週 / monthly 6 個月，自動淘汰 | `RETENTION_*` |
| 可用性（可還原性） | **每週自動還原測試**：還原到暫存 DB、比對資料表數與列數、通過才刪 | `wang-restore-test.timer` |
| 稽核（Log） | 每次執行寫入 journald（`journalctl -u wang-backup.service`）；失敗可寄信 | `MAIL_TO`（需 mailutils） |
| 還原所需設定 | .env 與 dump 同包加密（無 .env 無法重建 DATABASE_URL/AUTH_SECRET） | `backup.sh` 步驟 5 |

## Ubuntu VM 安裝步驟

```bash
# 0. 前置：docker + compose 已就緒，專案位於 /opt/wang，docker compose up -d 已啟動
cd /opt/wang

# 1. 安裝依賴（rclone 為選用：異地備份用；mailutils 為選用：失敗通知用）
sudo apt update
sudo apt install -y gnupg rclone mailutils

# 2. 執行一次性設定（建立目錄/金鑰/備份角色/設定檔/systemd 排程）
sudo ./scripts/setup-backup.sh
#    → 產生 /etc/wang-backup/backup.key
#    → 產生 /etc/wang-backup/backup.env（含隨機 backup_user 密碼）
#    → 啟用 wang-backup.timer（每日 02:10）與 wang-restore-test.timer（每週日 03:10）

# 3. ⚠️ 金鑰保管（最重要）：把 backup.key 內容複製進你的密碼管理器
cat /etc/wang-backup/backup.key   # 複製 → 存密碼管理器 → 這台機器以外唯一副本

# 4. 立即試跑（第一次務必手動驗證）
sudo ./scripts/backup.sh
sudo ./scripts/restore-test.sh    # 應看到 [restore-test] PASS

# 5. 確認排程生效
systemctl list-timers | grep wang
```

### 若部署路徑不是 /opt/wang

改 `deploy/systemd/*.service` 的 `ExecStart`，或在安裝後：

```bash
sudo ln -s /opt/wang/scripts/backup.sh /usr/local/bin/wang-backup
# 並把 .service 的 ExecStart 改成 /usr/local/bin/wang-backup（restore-test 同理）
```

## 異地備份（強烈建議，選用）

```bash
rclone config          # 新增 remote（例如 Cloudflare R2 / AWS S3，均支援 SSE 加密）
sudo nano /etc/wang-backup/backup.env
# RCLONE_REMOTE=myremote:wang-backups
```

之後每次備份會自動同步三層到異地，並用同樣的保留天數淘汰。**異地是防「主機整台毀損/被勒索」的最後一道防線**，本機備份被加密勒索時，異地副本不受影響。

## 手動還原（單檔，DR 流程）

```bash
cd /opt/wang
BACKUP_FILE=$(ls -1t /var/backups/wang/daily/wang-backup-*.tar.gz.gpg | head -1)

# 1. 驗證完整性 → 解密 → 解包
cd /var/backups/wang/daily && sha256sum -c "$(basename "$BACKUP_FILE").sha256"
mkdir -p /tmp/restore && cd /tmp/restore
gpg --batch --yes --pinentry-mode loopback --passphrase-file /etc/wang-backup/backup.key \
  -o archive.tar -d "$BACKUP_FILE"
tar xf archive.tar      # 得到 patent_graph.dump / patent-data.tar.gz / env.txt

# 2. 資料庫已壞（容器還活著）：直接覆蓋還原
#    （舊 .env 仍有效時；若密碼輪換過，先重啟 db 容器套用新密碼）
docker compose exec -T db pg_restore -U patent --clean --if-exists \
  -d patent_graph < patent_graph.dump

# 3. 全新 VM（DB 尚未建立）——順序關鍵: 先還原 .env，再起 db 容器
#    因為 postgres image 初始化時必須讀到 POSTGRES_PASSWORD，缺了起不來
cp env.txt /opt/wang/.env      # 若密碼輪換過，改用現行 .env
cd /opt/wang && docker compose up -d db
sleep 5
docker compose exec -T db createdb -U patent patent_graph
docker compose exec -T db pg_restore -U patent -d patent_graph < /tmp/restore/patent_graph.dump
# 4. 上傳檔案還原（先確認 app 資料夾存在）
docker compose up -d app
docker cp patent-data.tar.gz "$(docker compose ps -q app)":/tmp/ && \
  docker compose exec app sh -c 'cd /app/data && tar xzf /tmp/patent-data.tar.gz'
```

> 實際操作時依當下容器名調整；`--clean --if-exists` 會先清掉既有物件再還原。

## 監控

```bash
journalctl -u wang-backup.service -n 50        # 每日備份結果
journalctl -u wang-restore-test.service -n 50  # 每週還原測試結果
```

設定 `MAIL_TO=you@example.com`（需 `mailutils`）後，備份失敗會寄信；systemd 也會把 exit code 記進 journal。

## 金鑰輪換（建議每年一次）

```bash
sudo rm /etc/wang-backup/backup.key
sudo ./scripts/setup-backup.sh   # 重新產生金鑰；舊備份將無法解密 → 輪換後先跑一次新備份
# 密碼管理器同步更新
```

## 事件紀錄：backup.sql.gz 明文外洩（2026-08-13 處理）

- **事由**：`backup.sql.gz`（完整明文 DB dump，2026-08-04 產生）被 commit 至公開 repo（`yuzen9622/graph-patent-analysis`），期間資料庫內容公開可下載。
- **處理**：① 自 git 追蹤移除並加入 .gitignore；② `git filter-repo` 重寫歷史移除該檔；③ force push；④ 向 GitHub Support 申請清除公開快取（見下方連結）；⑤ 輪換 `POSTGRES_PASSWORD`。
- **殘餘風險**：已公開期間的下載無法回收，本質上視為資料已外洩。dump 內含專利申請人資料者，建議知會校園資安窗口並依校內個資事件流程辦理。
- 參考：<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository>

## 已知限制（與取捨）

- **非 PITR**：本方案為每日邏輯備份，最壞損失約 24 小時資料（RPO ≤ 24h）。若需求提升（如 RPO 小時級），再導入 WAL 歸檔 + pgBackRest/Barman。
- **data volume 完整性**：app 容器未執行時該輪僅備份資料庫（log 有 WARN）。
- **還原測試驗證深度**：比對資料表數與實際列數（真 count(*)，非估算），不做逐列比對（成本不成比例）。
- **socket trust 假設**：pg_dump/角色 bootstrap 都經容器內 unix socket 連線（官方 postgres image 預設 trust，僅限本機 docker exec）。SQL 一律經 stdin 餵給 psql、pg_dump 不帶 -e，**密碼不出現在 argv/env**（ps/auditd 看不到）；若 VM 改過認證方式，需調整 `scripts/lib/backup-common.sh` 的連線方式。
- **強制中斷（kill -9/斷電）可能留下明文暫存**：暫存在 root-only 的 `$BACKUP_DIR/.work.*`（0700），不會被他人讀取；下輪備份的 `trap` 會清理殘留（`rm -rf $WORK` 僅清當輪）。

## 部署到 Ubuntu VM 後的第一週驗證清單

以下路徑只能在 VM 上驗證（macOS 本機不可測），部署後第一週請逐項確認：

- [ ] `systemctl list-timers | grep wang` 顯示兩個 timer 已啟用（daily 02:10 / Sun 03:10）
- [ ] 等一次自動執行後 `journalctl -u wang-backup.service -n 30` 有「備份完成」
- [ ] `sudo ./scripts/restore-test.sh` 手動跑一次顯示 PASS
- [ ] 若啟用異地：`rclone copy /var/backups/wang <remote>:<path> --dry-run` 與實際同步各跑一次
- [ ] 若啟用通知：暫時在 backup.env 設 `MAIL_TO` 並故意 `docker compose stop db` 跑一次，確認收到失敗信
- [ ] 金鑰輪換流程演練一次（文件「金鑰輪換」節）
