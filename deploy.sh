#!/bin/bash
set -e

echo "🚀 Deploying Client Portal Stack..."

# Load env vars if .env exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Build and start
docker compose pull 2>/dev/null || true
docker compose build --no-cache
docker compose up -d

# Wait for API health
echo "⏳ Waiting for API to be healthy..."
for i in {1..30}; do
  if curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "✅ API is up!"
    break
  fi
  sleep 2
done

echo ""
echo "🎉 Deployment complete!"
echo "   Frontend: http://localhost"
echo "   API:      http://localhost:3001"
echo ""
echo "Logs: docker compose logs -f"
