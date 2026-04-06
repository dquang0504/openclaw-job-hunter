#!/bin/bash
# Step 4: Run this AFTER connecting to your Azure VM via SSH
# This script sets up the entire OpenClaw environment

set -e

echo "🔧 Setting up OpenClaw Job Hunter on Azure VM..."

# 1. Create 4GB swap file
echo "📦 Creating 4GB swap file..."
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
sudo sysctl vm.swappiness=10

# 2. Install Node.js 22
echo "📦 Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install Playwright dependencies
echo "🎭 Installing Playwright browser dependencies..."
sudo apt-get install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
  libcairo2 libasound2 libatspi2.0-0

# 4. Clone/setup project
echo "📂 Setting up project structure..."
mkdir -p ~/openclaw-job-hunter/{execution,directives,docs,.cookies,.tmp/screenshots,logs}
cd ~/openclaw-job-hunter

# 5. Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install --no-audit
npx playwright install chromium --with-deps
# 6. Verify installation
echo ""
echo "✅ Installation complete!"
echo "   Node.js: $(node --version)"
echo "   npm: $(npm --version)"
echo "   Swap: $(free -h | grep Swap | awk '{print $2}')"
echo ""
echo "📋 Next steps:"
echo "   1. Copy your .env file with Telegram credentials"
echo "   2. Copy your cookies to .cookies/"
echo "   3. Run: node execution/job-search.js --dry-run"
