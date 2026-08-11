#!/usr/bin/env bash
# End-to-end check of the whole chain: web app -> proxy -> Hermes API -> agent.
#
# The blocking assertion is the last one: tokens must arrive as separate
# assistant.delta frames. If they arrive as one frame at the end, something in
# the path is buffering (a reverse proxy without proxy_buffering off, or
# Cloudflare) and the typewriter effect is dead.
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3000}"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() {
	printf '  \033[31m✗\033[0m %s\n' "$1"
	exit 1
}

step "web app liveness"
curl -fsS "${BASE}/health" >/dev/null && ok "/health"

step "Hermes reachable through the proxy"
version=$(curl -fsS "${BASE}/api/capabilities" | python3 -c 'import sys,json;print(json.load(sys.stdin)["health"]["version"])')
ok "Hermes ${version}"

step "model catalogue"
model=$(curl -fsS "${BASE}/api/models" | python3 -c 'import sys,json;print(json.load(sys.stdin)["model"])')
ok "default model: ${model}"

step "saved prompts"
# Read-only on purpose: the library is user data, and a smoke test must not
# write into it. What matters is that the prefs-backed route answers a list.
nprompts=$(curl -fsS "${BASE}/api/prompts" |
	python3 -c 'import sys,json;d=json.load(sys.stdin);assert isinstance(d["prompts"],list);print(len(d["prompts"]))')
ok "prompt library: ${nprompts} entries"

step "providers panel"
# Non-blocking on purpose: the Hermes dashboard is a separate service and an
# unset HERMES_DASHBOARD_TOKEN is a supported configuration. What IS asserted
# is that the route answers a well-formed payload rather than 500ing.
providers=$(curl -fsS "${BASE}/api/providers" |
	python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["available"],len(d["keys"]),len(d["accounts"]),d["message"])')
read -r available nkeys naccounts message <<<"${providers}"
if [ "${available}" = "True" ]; then
	ok "dashboard reachable: ${nkeys} providers, ${naccounts} accounts"
else
	warn "providers panel disabled: ${message}"
fi

step "session create"
sid=$(curl -fsS -X POST -H 'Content-Type: application/json' \
	-d '{"title":"smoke '"$(date +%H%M%S)"'"}' "${BASE}/api/sessions" |
	python3 -c 'import sys,json;print(json.load(sys.stdin)["session"]["id"])')
ok "session ${sid}"

step "streaming turn (blocking test)"
out=$(mktemp)
timeout 180 curl -sN -X POST -H 'Content-Type: application/json' \
	-d '{"message":"Compte de 1 a 5, un chiffre par ligne, rien dautre."}' \
	"${BASE}/api/sessions/${sid}/stream" >"$out"

deltas=$(grep -c '^event: assistant.delta' "$out" || true)
grep -q '^event: run.completed' "$out" || fail "no run.completed — the turn did not finish"
[ "$deltas" -ge 2 ] || fail "only ${deltas} assistant.delta frame(s) — the stream is being buffered"
ok "${deltas} delta frames, run completed"

step "history round-trip"
count=$(curl -fsS "${BASE}/api/sessions/${sid}/messages?order=oldest" |
	python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]))')
[ "$count" -ge 2 ] || fail "transcript did not persist (${count} messages)"
ok "${count} messages persisted"

step "cleanup"
curl -fsS -X DELETE "${BASE}/api/sessions/${sid}" >/dev/null && ok "session deleted"
rm -f "$out"

printf '\n\033[32mAll checks passed.\033[0m\n'
