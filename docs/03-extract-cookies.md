# Step 3: Extract Browser Cookies for Session Persistence

Cookies allow the bot to skip login screens by using your existing authenticated sessions.

## 3.1 Install Cookie Export Extension

1. Install **EditThisCookie** or **Cookie-Editor** extension:
   - [Chrome: Cookie-Editor](https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
   - [Firefox: Cookie-Editor](https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/)

## 3.2 Export TopCV.vn Cookies

1. Go to [topcv.vn](https://www.topcv.vn) and **log in**
2. Click the Cookie-Editor extension icon
3. Click **"Export"** (copies to clipboard as JSON)
4. Create a file and paste:

```bash
# On your local machine
cat > ~/cookies-topcv.json << 'EOF'
[PASTE_CLIPBOARD_HERE]
EOF
```

## 3.3 Export X (Twitter) Cookies

1. Go to [x.com](https://x.com) and **log in**
2. Click Cookie-Editor → **Export**
3. Save to file:

```bash
cat > ~/cookies-twitter.json << 'EOF'
[PASTE_CLIPBOARD_HERE]
EOF
```

## 3.4 Transfer Cookies to Azure VM

```bash
# From your local machine
scp -i ~/Downloads/openclaw-vm_key.pem \
  ~/cookies-topcv.json ~/cookies-twitter.json \
  azureuser@<YOUR_VM_IP>:~/openclaw-automation/.cookies/
```

## 3.5 Cookie Security

> [!CAUTION]
> **Never commit cookies to git!** They contain your session tokens.

Add to `.gitignore`:
```
.cookies/
.env
```

---

## Cookie Format (Playwright)

The exported JSON will be converted to Playwright format by our scripts:

```json
[
  {
    "name": "session_id",
    "value": "abc123...",
    "domain": ".topcv.vn",
    "path": "/",
    "httpOnly": true,
    "secure": true
  }
]
```
