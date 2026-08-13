#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 一次性設定（Ubuntu VM）: 建立目錄 / 加密金鑰 / 最小權限備份角色 / 設定檔 / systemd 排程
#
# 用法:  sudo ./scripts/setup-backup.sh
# 測試:  BACKUP_ENV=/tmp/... KEY... ./scripts/setup-backup.sh --no-systemd
#        所有路徑可用環境變數覆寫（見下方變數），--no-systemd 跳過 systemd 安裝
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV_FILE="${BACKUP_ENV:-/etc/wang-backup/backup.env}"
KEY_FILE="${BACKUP_KEY_FILE:-/etc/wang-backup/backup.key}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wang}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/wang}"
BACKUP_DB="${BACKUP_DB:-patent_graph}"
BACKUP_USER="${BACKUP_USER:-backup_user}"
INSTALL_SYSTEMD=1
case "$*" in *--no-systemd*) INSTALL_SYSTEMD=0 ;; esac

# ── 1. 設定檔（已存在則跳過，避免覆寫既有密碼）────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
	echo "設定檔已存在: $ENV_FILE（保留。要重建請先刪除）"
else
	mkdir -p "$(dirname "$ENV_FILE")" "$BACKUP_DIR"/{daily,weekly,monthly}
	chmod 700 "$(dirname "$ENV_FILE")" "$BACKUP_DIR" "$BACKUP_DIR"/{daily,weekly,monthly}
	BACKUP_PASSWORD=$(openssl rand -hex 24)
	{
		echo "# wang 資料庫備份設定（root-only，勿進版控）"
		echo "COMPOSE_DIR=$COMPOSE_DIR"
		echo "BACKUP_DIR=$BACKUP_DIR"
		echo "ENC_KEY_FILE=$KEY_FILE"
		echo "BACKUP_DB=$BACKUP_DB"
		echo "BACKUP_USER=$BACKUP_USER"
		echo "BACKUP_PASSWORD=$BACKUP_PASSWORD"
		echo "BACKUP_APP_DATA=/app/data"
		echo "RETENTION_DAILY=7"
		echo "RETENTION_WEEKLY=4"
		echo "RETENTION_MONTHLY=6"
		echo "# 異地備份（選用）: rclone config 完成後填 remote:路徑"
		echo "RCLONE_REMOTE="
		echo "# 失敗通知（選用）: 需安裝 mailutils（mail 指令）"
		echo "MAIL_TO="
	} >"$ENV_FILE"
	chmod 600 "$ENV_FILE"
	echo "已建立設定檔: $ENV_FILE"
fi

# ── 2. 加密金鑰（AES-256 passphrase）──────────────────────────────────────
# ⚠️ 務必另存一份到密碼管理器: 主機若毀損，這份金鑰是唯一能解密備份的東西。
if [[ ! -s "$KEY_FILE" ]]; then
	umask 077
	openssl rand -base64 32 >"$KEY_FILE"
	chmod 600 "$KEY_FILE"
	echo "已產生加密金鑰: $KEY_FILE"
	echo ">>> 重要: 請立刻把金鑰內容複製到你的密碼管理器（金鑰與備份分開存放）"
else
	echo "加密金鑰已存在: $KEY_FILE"
fi

# ── 3. 最小權限備份角色（只讀: CONNECT + SELECT，無任何寫入權限）───────────
# shellcheck source=/dev/null
. "$ENV_FILE"
. "$(dirname "$0")/lib/backup-common.sh"
cd "$COMPOSE_DIR"
ensure_backup_role
echo "備份角色 ${BACKUP_USER} 已就緒（僅 CONNECT + SELECT，無寫入權限）"

# ── 4. systemd 排程（僅 Linux）────────────────────────────────────────────
if [[ "$INSTALL_SYSTEMD" == "1" ]] && [[ "$(uname -s)" == "Linux" ]]; then
	SRC="$(cd "$(dirname "$0")/../deploy/systemd" && pwd)"
	install -m 644 "$SRC"/wang-backup.service "$SRC"/wang-backup.timer \
		"$SRC"/wang-restore-test.service "$SRC"/wang-restore-test.timer /etc/systemd/system/
	systemctl daemon-reload
	systemctl enable --now wang-backup.timer wang-restore-test.timer
	systemctl status wang-backup.timer --no-pager | head -5
	echo "已啟用: wang-backup.timer（每日 02:10 備份）、wang-restore-test.timer（每週日 03:10 還原測試）"
elif [[ "$INSTALL_SYSTEMD" == "1" ]]; then
	echo "（跳過 systemd 安裝: 非 Linux 環境，僅本機測試模式）"
else
	echo "（--no-systemd 已指定，跳過 systemd 安裝）"
fi

echo "完成。立即試跑: sudo ./scripts/backup.sh && sudo ./scripts/restore-test.sh"
