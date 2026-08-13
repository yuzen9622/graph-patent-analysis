#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 還原測試: 解密最新日備份 → 還原至暫存 DB → 驗證 → 清理
#
# 目的: 證明備份「真的可以還原」。備份沒有測試過 = 沒有備份。
# 建議每週由 systemd timer 自動執行（deploy/systemd/wang-restore-test.timer）。
# 驗證項目: sha256 完整性 → 解密成功 → pg_restore 無錯誤 → 資料表數目與生產一致
#           → 資料列數 > 0。失敗時保留暫存 DB 供檢查。
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV_FILE="${BACKUP_ENV:-/etc/wang-backup/backup.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: 設定檔不存在: $ENV_FILE" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$ENV_FILE"

: "${COMPOSE_DIR:?backup.env 缺 COMPOSE_DIR}"
: "${BACKUP_DIR:?backup.env 缺 BACKUP_DIR}"
: "${ENC_KEY_FILE:?backup.env 缺 ENC_KEY_FILE}"
: "${BACKUP_DB:=patent_graph}"
TEST_DB="${BACKUP_DB}_restore_test"

cd "$COMPOSE_DIR"

LATEST=$(ls -1t "$BACKUP_DIR"/daily/wang-backup-*.tar.gz.gpg 2>/dev/null | head -1)
if [[ -z "$LATEST" ]]; then
  echo "ERROR: $BACKUP_DIR/daily 找不到備份檔" >&2
  exit 1
fi
echo "[restore-test $(date '+%F %T')] 測試備份: $(basename "$LATEST")"

# 1. 完整性: sha256 比對
( cd "$(dirname "$LATEST")" && sha256sum -c "$(basename "$LATEST").sha256" >/dev/null ) \
  || { echo "ERROR: sha256 不符，備份可能損壞或遭竄改"; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# 2. 解密 + 解包
gpg --batch --yes --pinentry-mode loopback -q --passphrase-file "$ENC_KEY_FILE" \
  -o "$WORK/archive.tar" -d "$LATEST"
tar xf "$WORK/archive.tar" -C "$WORK"

# 3. 重建暫存資料庫（先砍舊的）
docker compose exec -T db psql -U patent -d postgres \
  -c "DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE);" >/dev/null
docker compose exec -T db createdb -U patent "$TEST_DB"

# 4. 還原（--no-owner/--no-privileges: 一律還原成 patent 擁有；--exit-on-error: 任何錯誤即失敗）
docker compose exec -T db pg_restore -U patent --exit-on-error --no-owner --no-privileges \
  -d "$TEST_DB" < "$WORK/patent_graph.dump"

# 5. 驗證: 資料表數目與「實際列數」均與生產一致（真 count(*)，非統計估算）
#    query_to_xml 對每張表跑 count(*)，能抓到空還原/部分還原的假 PASS。
COUNT_SQL="SELECT sum(cnt::bigint) FROM (SELECT (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text AS cnt FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') t"
TABLES_PROD=$(docker compose exec -T db psql -U patent -d "$BACKUP_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
TABLES_TEST=$(docker compose exec -T db psql -U patent -d "$TEST_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
ROWS_PROD=$(docker compose exec -T db psql -U patent -d "$BACKUP_DB" -tAc "$COUNT_SQL")
ROWS_TEST=$(docker compose exec -T db psql -U patent -d "$TEST_DB" -tAc "$COUNT_SQL")

if [[ "$TABLES_PROD" == "$TABLES_TEST" && "$ROWS_PROD" == "$ROWS_TEST" && "$ROWS_PROD" != "0" && "$ROWS_PROD" != "" ]]; then
  echo "[restore-test] PASS: ${TABLES_TEST} 個資料表 / ${ROWS_TEST} 列（與生產一致）"
  docker compose exec -T db psql -U patent -d postgres \
    -c "DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE);" >/dev/null
  echo "[restore-test] 暫存資料庫 ${TEST_DB} 已清除"
else
  echo "[restore-test] FAIL: 資料表 prod=${TABLES_PROD}/test=${TABLES_TEST}、列數 prod=${ROWS_PROD}/test=${ROWS_TEST}" >&2
  echo "[restore-test] 暫存資料庫 ${TEST_DB} 保留供檢查；確認後手動刪除" >&2
  exit 1
fi
