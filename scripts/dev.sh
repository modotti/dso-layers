#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backend_python="$root_dir/backend/.venv/bin/python"

if [ ! -x "$backend_python" ]; then
  echo "Missing backend/.venv. Follow the backend setup in README.md first." >&2
  exit 1
fi

trap 'kill 0' INT TERM EXIT
(cd "$root_dir/backend" && "$backend_python" -m uvicorn app.main:app --reload --port 8000) &
(cd "$root_dir/frontend" && npm start) &
wait
