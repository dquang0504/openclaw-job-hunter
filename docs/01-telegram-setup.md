# Step 1: Create Your Telegram Bot & Get Credentials

## 1.1 Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Start a chat and send: `/newbot`
3. Follow the prompts:
   - **Name:** `GolangJobHunter` (display name)
   - **Username:** `your_unique_golang_job_bot` (must end in `bot`)
4. **Save the Bot Token** — looks like: `7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxx`

## 1.2 Get Your Chat ID

1. Start a conversation with your new bot (send any message)
2. Open this URL in your browser (replace `YOUR_BOT_TOKEN`):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
3. Look for `"chat":{"id":123456789}` — that number is your **Chat ID**

## 1.3 Test Your Bot

Run this curl command to verify (replace placeholders):

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/sendMessage" \
  -d "chat_id=<YOUR_CHAT_ID>" \
  -d "text=🤖 Bot is working!"
```

You should receive the message in Telegram.

---

## Save These Values

Create a `.env` file in the project root:

```bash
TELEGRAM_BOT_TOKEN=7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=123456789
```
