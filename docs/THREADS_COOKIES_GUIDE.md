# Hướng dẫn Export Cookies cho Threads

## Vấn đề
Threads login qua Instagram, nên cookies cần bao gồm cả:
- `.threads.net` domain
- `.instagram.com` domain

## Cách Export Cookies đúng

### Option 1: Dùng EditThisCookie Extension (Recommended)

1. **Cài Extension**: [EditThisCookie](https://chrome.google.com/webstore/detail/editthiscookie/fngmhnnpilhplaeedifhccceomclgfbg)

2. **Login vào Threads**: Mở https://www.threads.net/ và login

3. **Export cookies**:
   - Click icon EditThisCookie
   - Click "Export" (biểu tượng xuất file)
   - Paste vào file `.cookies/cookies-threads.json`

4. **Quan trọng**: Cookies phải có cả 2 domains:
   ```json
   [
     { "domain": ".threads.net", "name": "sessionid", ... },
     { "domain": ".instagram.com", "name": "sessionid", ... },
     ...
   ]
   ```

### Option 2: Manual từ DevTools

1. Login vào Threads
2. Mở DevTools (F12)
3. Tab "Application" → "Cookies"
4. Copy cookies từ CẢ HAI:
   - `https://www.threads.net`
   - `https://www.instagram.com`

5. Format thành JSON array và save vào `.cookies/cookies-threads.json`

## Verify Cookies

Chạy test để verify:
```bash
node testing/test-threads.js
```

Nếu thành công sẽ thấy:
```
🔐 Verifying login status...
   Current URL: https://www.threads.net/
   ✅ LOGGED IN successfully
```

Nếu fail sẽ thấy:
```
🔐 Verifying login status...
   Current URL: https://www.threads.net/login
   ❌ NOT LOGGED IN - Cookies are invalid or missing Instagram cookies
```

## Cookies hiện tại thiếu gì?

File `.cookies/cookies-threads.json` hiện tại chỉ có cookies cho `.threads.net`.
Cần thêm cookies cho `.instagram.com` (đặc biệt là `sessionid`, `csrftoken`, `ds_user_id`).
