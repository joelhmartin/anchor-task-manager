#!/usr/bin/env bash
#
# Start local development with ngrok tunnel for webhook testing.
#
# Usage:
#   ./dev-ngrok.sh           # Start server + ngrok tunnel
#   ./dev-ngrok.sh --full    # Start server + frontend + ngrok tunnel
#
# Prerequisites:
#   - ngrok installed (brew install ngrok)
#   - ngrok authenticated (ngrok authtoken YOUR_TOKEN)
#
# What this does:
#   1. Starts the backend server on port 4000
#   2. Starts ngrok tunnel to expose port 4000
#   3. Displays the public URL for webhooks/embeds
#   4. Optionally starts the frontend too (--full mode)
#
# The ngrok URL can be used for:
#   - Twilio webhooks (call tracking)
#   - Form embeds on external sites
#   - Tracking script testing
#   - OAuth callbacks

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
  echo -e "${RED}Error: ngrok is not installed${NC}"
  echo "Install with: brew install ngrok"
  echo "Then authenticate: ngrok authtoken YOUR_TOKEN"
  exit 1
fi

# Parse arguments
FULL_MODE=false
if [[ "$1" == "--full" ]]; then
  FULL_MODE=true
fi

# Cleanup function
cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down...${NC}"
  kill $SERVER_PID $NGROK_PID $CLIENT_PID 2>/dev/null || true
  wait $SERVER_PID $NGROK_PID $CLIENT_PID 2>/dev/null || true

  # Clean up temp file
  rm -f /tmp/ngrok-anchor.json

  echo -e "${GREEN}Done.${NC}"
  exit 0
}
trap cleanup INT TERM

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Anchor Development Server with ngrok Tunnel${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Start backend server
echo -e "${BLUE}[1/3]${NC} Starting backend server..."
nodemon --watch server --watch .env --ext js,json server/index.js > /tmp/anchor-server.log 2>&1 &
SERVER_PID=$!
sleep 2

# Check if server started
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo -e "${RED}Error: Backend server failed to start${NC}"
  echo "Check logs: tail -f /tmp/anchor-server.log"
  exit 1
fi
echo -e "${GREEN}  ✓ Backend running on http://localhost:4000${NC}"

# Start tunnel (cloudflared preferred — no browser warning page)
echo -e "${BLUE}[2/3]${NC} Starting tunnel..."
if command -v cloudflared &> /dev/null; then
  cloudflared tunnel --url http://localhost:4000 --logfile /tmp/ngrok-anchor.log --loglevel info > /dev/null 2>&1 &
  NGROK_PID=$!
  sleep 4

  NGROK_URL=""
  for i in {1..15}; do
    NGROK_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/ngrok-anchor.log 2>/dev/null | tail -1)
    if [[ -n "$NGROK_URL" ]]; then break; fi
    sleep 1
  done
  TUNNEL_TYPE="cloudflared"
else
  ngrok http 4000 --log=stdout > /tmp/ngrok-anchor.log 2>&1 &
  NGROK_PID=$!
  sleep 3

  NGROK_URL=""
  for i in {1..10}; do
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*' | head -1 | cut -d'"' -f4)
    if [[ -n "$NGROK_URL" ]]; then break; fi
    sleep 1
  done
  TUNNEL_TYPE="ngrok"
fi

if [[ -z "$NGROK_URL" ]]; then
  echo -e "${RED}Error: Could not get tunnel URL${NC}"
  echo "Logs: tail -f /tmp/ngrok-anchor.log"
  cleanup
  exit 1
fi

echo -e "${GREEN}  ✓ ${TUNNEL_TYPE} tunnel: ${NGROK_URL}${NC}"

# Optionally start frontend
if $FULL_MODE; then
  echo -e "${BLUE}[3/3]${NC} Starting frontend..."
  yarn start > /tmp/anchor-frontend.log 2>&1 &
  CLIENT_PID=$!
  sleep 2
  echo -e "${GREEN}  ✓ Frontend running on http://localhost:3000${NC}"
else
  echo -e "${BLUE}[3/3]${NC} Frontend skipped (use --full to include)"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Ready!${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Public URL:${NC}  ${NGROK_URL}"
echo -e "${YELLOW}API Base:${NC}    ${NGROK_URL}/api"
echo ""
echo -e "${BLUE}Webhook URLs for Twilio:${NC}"
echo "  Voice:         ${NGROK_URL}/api/twilio/voice"
echo "  Status:        ${NGROK_URL}/api/twilio/status"
echo "  Recording:     ${NGROK_URL}/api/twilio/recording"
echo "  Transcription: ${NGROK_URL}/api/twilio/transcription"
echo ""
echo -e "${BLUE}Embed Script URLs:${NC}"
echo "  Tracking: ${NGROK_URL}/tracking/anchor-tracking.js"
echo "  Forms:    ${NGROK_URL}/forms/anchor-forms.js"
echo ""
echo -e "${BLUE}To update .env with this URL:${NC}"
echo "  echo 'APP_BASE_URL=${NGROK_URL}' >> .env"
echo ""
echo -e "${BLUE}To reconfigure Twilio webhooks:${NC}"
echo "  1. Set APP_BASE_URL in .env to the ngrok URL above"
echo "  2. Restart the server (it will auto-reload)"
echo "  3. In TwilioManager, click 'Reconfigure Webhooks'"
echo ""
echo -e "${BLUE}Logs:${NC}"
echo "  Server:   tail -f /tmp/anchor-server.log"
echo "  ngrok:    tail -f /tmp/ngrok-anchor.log"
if $FULL_MODE; then
  echo "  Frontend: tail -f /tmp/anchor-frontend.log"
fi
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Wait for processes
wait
