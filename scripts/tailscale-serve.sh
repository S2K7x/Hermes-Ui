#!/usr/bin/env bash
# Publish the web app on the tailnet over HTTPS.
#
# Why Tailscale Serve rather than Cloudflare Tunnel: Cloudflare buffers
# text/event-stream and cuts the request at a fixed 100 s Proxy Read Timeout
# (error 524) on Free/Pro/Business — which is shorter than a single Hermes turn
# that thinks and calls tools. Tailscale's proxy is Go's httputil.ReverseProxy,
# which flushes SSE as it arrives and imposes no duration cap.
set -euo pipefail

PORT="${PORT:-3000}"

if ! command -v tailscale >/dev/null 2>&1; then
	echo "tailscale not found. Install it first: https://tailscale.com/download" >&2
	exit 1
fi

echo "Publishing http://127.0.0.1:${PORT} on the tailnet…"
sudo tailscale serve --bg --https=443 "http://127.0.0.1:${PORT}"

HOSTNAME=$(tailscale status --json | python3 -c 'import sys,json;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
echo
echo "Reachable at: https://${HOSTNAME}"
echo
echo "Set this in .env so SvelteKit accepts POSTs from it, then rebuild:"
echo "  HERMES_PUBLIC_ORIGIN=https://${HOSTNAME}"
echo
echo "Status:  tailscale serve status"
echo "Remove:  sudo tailscale serve --https=443 off"
