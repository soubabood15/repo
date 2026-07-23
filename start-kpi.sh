#!/bin/sh
set -eu

cd "$(dirname "$0")"
KPI_PORT="${KPI_PORT:-5500}"
KPI_URL="http://127.0.0.1:${KPI_PORT}/KPI.html"

if command -v open >/dev/null 2>&1; then
  (sleep 1; open "$KPI_URL") &
fi

echo "CALL CENTER KPI ANALYZER"
echo "Open: $KPI_URL"
echo "Press Ctrl+C to stop."
python3 -m http.server "$KPI_PORT" --bind 127.0.0.1
