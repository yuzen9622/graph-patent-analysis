#!/usr/bin/env bash
# wang 資料庫備份共用函式（由 backup.sh / setup-backup.sh / restore-test.sh source）

# 確保最小權限備份角色存在（冪等；每次執行同步密碼與授權）
# 以專案 owner 身份經容器內 unix socket 連線（官方 postgres image 對 socket 為 trust）。
# 若 VM 上改過認證方式，請改用 postgres superuser 執行本函式。
# SQL 一律經 stdin 餵給 psql（不用 -c），避免密碼出現在 argv（ps/auditd 可見）。
ensure_backup_role() {
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U patent -d "$BACKUP_DB" -f - <<SQL >/dev/null
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${BACKUP_USER}') THEN
    CREATE ROLE ${BACKUP_USER} LOGIN PASSWORD '${BACKUP_PASSWORD}';
  END IF;
END
\$\$;
ALTER ROLE ${BACKUP_USER} WITH LOGIN PASSWORD '${BACKUP_PASSWORD}';
GRANT CONNECT ON DATABASE ${BACKUP_DB} TO ${BACKUP_USER};
GRANT USAGE ON SCHEMA public TO ${BACKUP_USER};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${BACKUP_USER};
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${BACKUP_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${BACKUP_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${BACKUP_USER};
SQL
}
