# Step 6: GitHub Actions Deployment (Free Alternative)

Thay vì Azure VM, chúng ta dùng GitHub Actions để chạy job search tự động.

## Ưu điểm

| Tính năng | Chi tiết |
|-----------|----------|
| **Free** | 2000 phút/tháng (public repo) |
| **Tự động** | Chạy theo schedule, tự tắt |
| **Không cần VM** | GitHub host sẵn |

## 6.1 Tạo GitHub Repository

```bash
cd ~/Go\ Test\ Projects/openclaw-automation
git init
git add .
git commit -m "Initial commit"

# Tạo repo trên GitHub (public để được 2000 phút free)
gh repo create openclaw-automation --public --source=. --push
```

Hoặc tạo thủ công trên github.com rồi push.

## 6.2 Thêm Secrets vào Repository

1. Vào repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** và thêm:

| Secret Name | Value |
|-------------|-------|
| `TELEGRAM_BOT_TOKEN` | `7123456789:AAHxxx...` |
| `TELEGRAM_CHAT_ID` | `123456789` |
| `COOKIES_TOPCV` | Nội dung file `cookies-topcv.json` |
| `COOKIES_TWITTER` | Nội dung file `cookies-twitter.json` |

## 6.3 Tạo package.json

```bash
npm init -y
npm install playwright node-telegram-bot-api dotenv
git add package.json package-lock.json
git commit -m "Add dependencies"
git push
```

## 6.4 Kích hoạt Workflow

1. Vào repo → **Actions** tab
2. Click **"I understand my workflows, go ahead and enable them"**
3. Workflow sẽ tự chạy theo schedule (mỗi 2 giờ)

## 6.5 Chạy thủ công (Test)

1. Actions → **Job Search** workflow
2. Click **"Run workflow"** → **"Run workflow"**
3. Kiểm tra Telegram xem có nhận tin nhắn không

---

## Schedule (UTC+7)

Workflow chạy vào các giờ sau (giờ Việt Nam):
- 2:00, 4:00, 6:00, 8:00, 10:00, 12:00
- 14:00, 16:00, 18:00, 20:00, 22:00

**Tổng: ~12 lần/ngày × 5 phút = 60 phút/ngày = 1800 phút/tháng** ✅

## Xem Logs

1. Actions → Click vào run gần nhất
2. Click **"search-jobs"** → Xem output
3. Artifacts chứa file log chi tiết
