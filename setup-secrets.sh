#!/bin/bash
# Extract cookies from .cookies directory to .secrets format
# This helps you quickly set up .secrets file

set -e

echo "🍪 Extracting cookies to .secrets format..."
echo ""

# Check if .cookies directory exists
if [ ! -d ".cookies" ]; then
    echo "❌ Error: .cookies directory not found!"
    exit 1
fi

# Create .secrets file if it doesn't exist
if [ ! -f ".secrets" ]; then
    echo "# Auto-generated secrets file" > .secrets
    echo "# Fill in your actual API keys below" >> .secrets
    echo "" >> .secrets
fi

# Check if secrets are already in .secrets
if ! grep -q "TELEGRAM_BOT_TOKEN=" .secrets; then
    echo "TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here" >> .secrets
fi

if ! grep -q "TELEGRAM_CHAT_ID=" .secrets; then
    echo "TELEGRAM_CHAT_ID=your_telegram_chat_id_here" >> .secrets
fi

if ! grep -q "GROQ_API_KEY=" .secrets; then
    echo "GROQ_API_KEY=your_groq_api_key_here" >> .secrets
fi

if ! grep -q "CLOUDFLARE_API_KEY=" .secrets; then
    echo "CLOUDFLARE_API_KEY=your_cloudflare_api_key_here" >> .secrets
fi

echo "✅ .secrets file created/updated!"
echo ""
echo "📝 Cookie files found:"
ls -1 .cookies/*.json 2>/dev/null | sed 's/^/  - /'
echo ""
echo "⚠️  Note: Cookies are already in .cookies/ directory."
echo "    The workflow will use them automatically."
echo ""
echo "📋 Next steps:"
echo "  1. Edit .secrets file and fill in your API keys:"
echo "     nano .secrets"
echo ""
echo "  2. Run the local workflow:"
echo "     ./run-local.sh"
echo ""
