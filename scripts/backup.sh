#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# wang 專案資料庫安全備份（面向 Ubuntu VM + docker compose 部署）
#
# 流程: pg_dump(-Fc) + app data tar + .env
#       → tar 打包 → gpg AES-256 加密 → sha256 指紋
#       → 分層保留 (daily 7 / weekly 4 / monthly 6)
#       → 選用 rclone 異地同步 → 失敗可寄信通知
#
# 設定: BACKUP_ENV 指定設定檔路徑（預設 /etc/wang-backup/backup.env）
#       由 scripts/setup-backup.sh 產生；所有參數可在該檔覆寫。
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV_FILE="${BACKUP_ENV:-/etc/wang-backup/backup.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: 設定檔不存在: $ENV_FILE（請先執行 sudo ./scripts/setup-backup.sh）" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$ENV_FILE"

# 必要參數檢查（backup.env 缺一不可）
: "${COMPOSE_DIR:?backup.env 缺 COMPOSE_DIR（docker compose 所在目錄）}"
: "${BACKUP_DIR:?backup.env 缺 BACKUP_DIR}"
: "${ENC_KEY_FILE:?backup.env 缺 ENC_KEY_FILE}"
: "${BACKUP_PASSWORD:?backup.env 缺 BACKUP_PASSWORD（最小權限備份角色）}"
: "${BACKUP_DB:=patent_graph}"
: "${BACKUP_USER:=backup_user}"
: "${BACKUP_APP_DATA:=/app/data}"
: "${RETENTION_DAILY:=7}"
: "${RETENTION_WEEKLY:=4}"
: "${RETENTION_MONTHLY:=6}"

log() { echo "[backup $(date '+%F %T')] $*"; }

fail_mail() {
  if [[ -n "${MAIL_TO:-}" ]] && command -v mail >/dev/null 2>&1; then
    echo "wang 資料庫備份失敗: $1" | mail -s "[wang-backup] FAILED $(hostname) $(date '+%F %T')" "$MAIL_TO"
  fi
}

cd "$COMPOSE_DIR"

# 錯誤處理: 任何步驟失敗 → 清暫存 + 記錄 + 可選通知
trap 'code=$?; log "ERROR: 備份失敗 (exit $code)"; fail_mail "exit $code"' ERR
trap 'rm -rf "${WORK:-}"' EXIT

# 依賴檢查
command -v gpg >/dev/null 2>&1 || { fail_mail "缺 gpg"; exit 1; }
[[ -s "$ENC_KEY_FILE" ]] || { fail_mail "加密金鑰不存在或為空: $ENC_KEY_FILE"; exit 1; }
docker compose exec -T db pg_isready -U "$BACKUP_USER" -d "$BACKUP_DB" >/dev/null 2>&1 \
  || { fail_mail "db 容器未在執行"; exit 1; }
mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}
chmod 700 "$BACKUP_DIR" "$BACKUP_DIR"/{daily,weekly,monthly}

# ── 1. 確保最小權限備份角色（CONNECT+SELECT，無任何寫入權限）──────────────
# shellcheck source=/dev/null
. "$(dirname "$0")/lib/backup-common.sh"
ensure_backup_role
log "備份角色 ${BACKUP_USER} 已就緒"

# ── 2. 暫存工作區（放在 root-only 的 BACKUP_DIR 下，避免 /tmp 明文殘留）───
TS=$(date +%Y%m%d-%H%M%S)
WORK=$(mktemp -d "${BACKUP_DIR}/.work.XXXXXX")
chmod 700 "$WORK"

# ── 3. 資料庫邏輯備份（custom format: 壓縮、可選擇性還原、可作 PITR 基礎）──
#    認證: 經容器內 unix socket（官方 postgres image 預設 trust）連線，
#    因此不把 BACKUP_PASSWORD 放進任何 argv/env（ps/proc 看不到密碼）。
log "pg_dump ${BACKUP_DB} ..."
docker compose exec -T db \
  pg_dump -U "$BACKUP_USER" -Fc -d "$BACKUP_DB" > "$WORK/patent_graph.dump"

# ── 4. 上傳檔案（Excel / JSON snapshots；app 容器內資料夾）─────────────────
if docker compose exec -T app true >/dev/null 2>&1; then
  log "備份 app data（${BACKUP_APP_DATA}）..."
  docker compose exec -T app tar czf - -C "$BACKUP_APP_DATA" . > "$WORK/patent-data.tar.gz"
else
  log "WARN: app 容器未在執行，本輪僅含資料庫（data volume 未備份）"
fi

# ── 5. .env（還原所需之密碼/金鑰設定；與 dump 同包加密）────────────────────
if [[ -f "$COMPOSE_DIR/.env" ]]; then
  cp "$COMPOSE_DIR/.env" "$WORK/env.txt"
fi

# ── 6. 打包 + AES-256 加密（金鑰檔案 root-only；務必另存密碼管理器）────────
ARCHIVE="wang-backup-${TS}.tar.gz.gpg"
FILES=("patent_graph.dump" "env.txt")
[[ -f "$WORK/patent-data.tar.gz" ]] && FILES+=("patent-data.tar.gz")
tar cf "$WORK/archive.tar" -C "$WORK" "${FILES[@]}"
gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 -q \
  --passphrase-file "$ENC_KEY_FILE" -z 9 \
  -o "$BACKUP_DIR/daily/$ARCHIVE" "$WORK/archive.tar"
chmod 600 "$BACKUP_DIR/daily/$ARCHIVE"
( cd "$BACKUP_DIR/daily" && sha256sum "$ARCHIVE" > "$ARCHIVE.sha256" && chmod 600 "$ARCHIVE.sha256" )
log "完成: $BACKUP_DIR/daily/$ARCHIVE（還原性由每週 restore-test.sh 驗證）"

# ── 7. 分層保留（daily 保留 N 天；每週一與每月 1 日各抽一份長保留）────────
find "$BACKUP_DIR/daily" \( -name 'wang-backup-*.tar.gz.gpg' -o -name '*.sha256' \) \
  -mtime "+$RETENTION_DAILY" -delete
if [[ "$(date +%u)" == "1" ]]; then
  cp "$BACKUP_DIR/daily/$ARCHIVE" "$BACKUP_DIR/weekly/"
  find "$BACKUP_DIR/weekly" -name '*.gpg' -mtime "+$((RETENTION_WEEKLY * 7))" -delete
fi
if [[ "$(date +%d)" == "01" ]]; then
  cp "$BACKUP_DIR/daily/$ARCHIVE" "$BACKUP_DIR/monthly/"
  find "$BACKUP_DIR/monthly" -name '*.gpg' -mtime "+$((RETENTION_MONTHLY * 30))" -delete
fi

# ── 8. 異地備份（選用；rclone remote 建議啟用 SSE 的 object storage）──────
if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  command -v rclone >/dev/null 2>&1 || { fail_mail "已設定 RCLONE_REMOTE 但缺 rclone"; exit 1; }
  log "rclone 同步到 $RCLONE_REMOTE ..."
  rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" -q --transfers 1
  rclone delete "$RCLONE_REMOTE/daily"   --max-age "${RETENTION_DAILY}d" -q || true
  rclone delete "$RCLONE_REMOTE/weekly"  --max-age "$((RETENTION_WEEKLY * 7))d" -q || true
  rclone delete "$RCLONE_REMOTE/monthly" --max-age "$((RETENTION_MONTHLY * 30))d" -q || true
  log "異地同步完成"
fi

trap - ERR
log "備份完成（還原性由 restore-test.sh 每週自動驗證）"
