# Step 3: Extract Browser Cookies for Session Persistence

Cookies allow the bot to skip login screens by using your existing authenticated sessions.

> [!NOTE]
> The current runtime no longer uses TopCV cookies. The active runtime currently relies on cookies for X/Twitter, Facebook, Threads, TopDev, ITViec, and Vercel.

## 3.1 Install Cookie Export Extension

1. Install **EditThisCookie** or **Cookie-Editor** extension:
   - [Chrome: Cookie-Editor](https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
   - [Firefox: Cookie-Editor](https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/)

## 3.2 Export Cookies For An Active Platform

Use the same steps for any currently active cookie-backed platform:
- [x.com](https://x.com)
- [facebook.com](https://www.facebook.com)
- [threads.net](https://www.threads.net)
- [topdev.vn](https://topdev.vn)
- [itviec.com](https://itviec.com)
- [vercel.com](https://vercel.com)

1. Open the platform and **log in**
2. Click the Cookie-Editor extension icon
3. Click **"Export"** (copies to clipboard as JSON)
4. Create the matching cookie file and paste:

```bash
cat > ~/cookies-facebook.json << 'EOF'
[PASTE_CLIPBOARD_HERE]
EOF
```

Common filenames used by the runtime:
- `cookies-twitter.json`
- `cookies-facebook.json`
- `cookies-threads.json`
- `cookies-topdev.json`
- `cookies-itviec.json`
- `cookies-vercel.json`

## 3.3 Export X (Twitter) Cookies

```bash
cat > ~/cookies-twitter.json << 'EOF'
[PASTE_CLIPBOARD_HERE]
EOF
```

## 3.4 Transfer Cookies to Azure VM

```bash
# From your local machine
scp -i ~/Downloads/openclaw-vm_key.pem \
  ~/cookies-facebook.json ~/cookies-twitter.json \
  azureuser@<YOUR_VM_IP>:~/openclaw-job-hunter/.cookies/
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
    "domain": ".facebook.com",
    "path": "/",
    "httpOnly": true,
    "secure": true
  }
]
```
