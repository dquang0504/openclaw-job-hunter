#!/bin/bash
# Local Workflow Runner for Job Search
# This script simulates the GitHub Actions workflow locally

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Local Workflow Runner${NC}"
echo "================================"

# Check if .secrets file exists
if [ ! -f .secrets ]; then
    echo -e "${RED}❌ Error: .secrets file not found!${NC}"
    echo ""
    echo "Please create .secrets file with the following content:"
    echo ""
    cat .secrets.example
    echo ""
    echo "Then run this script again."
    exit 1
fi

# Load secrets
echo -e "${GREEN}✅ Loading secrets from .secrets${NC}"
export $(cat .secrets | grep -v '^#' | xargs)

# Check required secrets
REQUIRED_SECRETS=("TELEGRAM_BOT_TOKEN" "TELEGRAM_CHAT_ID" "GROQ_API_KEY")
MISSING_SECRETS=()

for secret in "${REQUIRED_SECRETS[@]}"; do
    if [ -z "${!secret}" ]; then
        MISSING_SECRETS+=("$secret")
    fi
done

if [ ${#MISSING_SECRETS[@]} -gt 0 ]; then
    echo -e "${RED}❌ Missing required secrets:${NC}"
    for secret in "${MISSING_SECRETS[@]}"; do
        echo "  - $secret"
    done
    exit 1
fi

# Create necessary directories
echo -e "${GREEN}✅ Creating directories${NC}"
mkdir -p .cookies logs .tmp/screenshots

# Check if cookies exist
COOKIE_FILES=(
    ".cookies/cookies-topcv.json"
    ".cookies/cookies-twitter.json"
    ".cookies/cookies-linkedin.json"
    ".cookies/cookies-facebook.json"
    ".cookies/cookies-threads.json"
    ".cookies/cookies-topdev.json"
    ".cookies/cookies-itviec.json"
    ".cookies/cookies-vercel.json"
)

MISSING_COOKIES=()
for cookie_file in "${COOKIE_FILES[@]}"; do
    if [ ! -f "$cookie_file" ]; then
        MISSING_COOKIES+=("$cookie_file")
    fi
done

if [ ${#MISSING_COOKIES[@]} -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Warning: Some cookie files are missing:${NC}"
    for cookie_file in "${MISSING_COOKIES[@]}"; do
        echo "  - $cookie_file"
    done
    echo ""
    echo "The scrapers for these platforms may not work properly."
    echo "Press Enter to continue anyway, or Ctrl+C to cancel..."
    read
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed!${NC}"
    echo "Please install Node.js 22 or higher."
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  node_modules not found. Installing dependencies...${NC}"
    npm install
fi

# Check if Playwright browsers are installed
if [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "$HOME/Library/Caches/ms-playwright" ]; then
    echo -e "${YELLOW}⚠️  Playwright browsers not found. Installing...${NC}"
    npx playwright install chromium --with-deps
fi

# Parse arguments
PLATFORM="${1:-topcv,twitter,indeed,vercel,cloudflare,topdev,itviec}"

echo ""
echo -e "${BLUE}🔍 Running job search for platform: ${PLATFORM}${NC}"
echo "================================"
echo ""

# Check if running in CI simulation mode
if [[ "$2" == "--ci" ]]; then
    if ! command -v xvfb-run &> /dev/null; then
        echo -e "${RED}❌ xvfb-run is not installed!${NC}"
        echo "Please install it: sudo apt-get install xvfb"
        exit 1
    fi
    echo -e "${YELLOW}⚠️  Simulating GitHub Actions environment (headless with xvfb)...${NC}"
    xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" node execution/job-search.js --platform="$PLATFORM"
else
    # Run normally with visible browser (if headless: false in config)
    node execution/job-search.js --platform="$PLATFORM"
fi

echo ""
echo -e "${GREEN}✅ Job search completed!${NC}"
echo ""
echo "Check the logs directory for results:"
echo "  ls -lh logs/job-search-*.json"
