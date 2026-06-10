#!/usr/bin/env bash
# Start both backend (nodemon) and frontend (vite) for local development.
# Usage: ./dev.sh

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $SERVER_PID $CLIENT_PID 2>/dev/null
  wait $SERVER_PID $CLIENT_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Backend — nodemon watches server/ and .env for changes
nodemon --watch server --watch .env --ext js,json server/index.js &
SERVER_PID=$!

# Frontend — Vite dev server
yarn start &
CLIENT_PID=$!

echo "Backend (nodemon) PID: $SERVER_PID  →  http://localhost:4000"
echo "Frontend (vite)   PID: $CLIENT_PID  →  http://localhost:3000"
echo "Press Ctrl+C to stop both."

wait
