#!/usr/bin/env bash
# Nightly backup of everything that is not reproducible from the repo:
# the Hermes state DB (all chat history + long-term memory), its config and
# secrets, and the web app's own SQLite.
#
# SQLite files are copied with `.backup`, not `cp` — copying a live WAL
# database byte-for-byte can capture a torn state that will not open.
#
# Install:
#   crontab -e
#   17 3 * * *  /opt/stacks/Hermes-Ui/scripts/backup.sh >> /var/log/hermes-backup.log 2>&1
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
WEB_DATA_DIR="${WEB_DATA_DIR:-/opt/stacks/Hermes-Ui/data}"
DEST="${BACKUP_DIR:-/mnt/data/backups/hermes}"
KEEP_DAYS="${KEEP_DAYS:-14}"
# Off-Pi copy target for rsync, e.g. nas:/volume1/backups/hermes. A backup
# that only exists on the machine that can fail is not a backup.
REMOTE="${BACKUP_REMOTE:-}"

stamp=$(date +%Y%m%d_%H%M%S)
work="${DEST}/${stamp}"
mkdir -p "$work"

# Online backup of a live SQLite file.
#
# The `sqlite3` CLI is NOT installed on this Pi (measured: `which sqlite3`
# returns nothing), and `set -e` turned that into a silent no-backup — the
# script died on its first database and left an empty directory behind, every
# time it was run. Python's stdlib carries the same online-backup API
# (`Connection.backup`, SQLITE_BACKUP under the hood), and python3 is part of
# the base system, so it is the fallback rather than a new dependency.
sqlite_backup() {
	local src=$1 dst=$2
	[ -f "$src" ] || return 0
	if command -v sqlite3 >/dev/null 2>&1; then
		sqlite3 "$src" ".backup '${dst}'"
	elif command -v python3 >/dev/null 2>&1; then
		python3 - "$src" "$dst" <<-'PY'
			import sqlite3, sys
			src, dst = sys.argv[1], sys.argv[2]
			# Read-only on the source: a backup must never be able to write to
			# the database the agent is using while it runs.
			source = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
			target = sqlite3.connect(dst)
			with target:
			    source.backup(target)
			target.close()
			source.close()
		PY
	else
		echo "ni sqlite3 ni python3 : impossible de sauvegarder ${src}" >&2
		return 1
	fi
}

sqlite_backup "${HERMES_HOME}/state.db" "${work}/state.db"
sqlite_backup "${HERMES_HOME}/kanban.db" "${work}/kanban.db"
sqlite_backup "${WEB_DATA_DIR}/hermes-web.db" "${work}/hermes-web.db"

cp -a "${HERMES_HOME}/config.yaml" "${work}/config.yaml" 2>/dev/null || true
# Contains API_SERVER_KEY and provider keys — the archive is chmod 600 below.
cp -a "${HERMES_HOME}/.env" "${work}/hermes.env" 2>/dev/null || true
cp -a "/opt/stacks/Hermes-Ui/.env" "${work}/web.env" 2>/dev/null || true

tar -czf "${DEST}/hermes-${stamp}.tar.gz" -C "$DEST" "$stamp"
chmod 600 "${DEST}/hermes-${stamp}.tar.gz"
rm -rf "$work"

find "$DEST" -maxdepth 1 -name 'hermes-*.tar.gz' -mtime "+${KEEP_DAYS}" -delete

if [ -n "$REMOTE" ]; then
	rsync -a "${DEST}/hermes-${stamp}.tar.gz" "$REMOTE/"
fi

echo "$(date -Is) backup ok: ${DEST}/hermes-${stamp}.tar.gz"
