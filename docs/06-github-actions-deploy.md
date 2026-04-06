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
cd ~/Go\ Test\ Projects/openclaw-job-hunter
git init
git add .
git commit -m "Initial commit"

# Tạo repo trên GitHub (public để được 2000 phút free)
gh repo create openclaw-job-hunter --public --source=. --push
```

Hoặc tạo thủ công trên github.com rồi push.

## 6.2 Thêm Secrets vào Repository

1. Vào repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** và thêm:

| Secret Name | Value |
|-------------|-------|
| `TELEGRAM_BOT_TOKEN` | `7123456789:AAHxxx...` |
| `TELEGRAM_CHAT_ID` | `123456789` |
| `COOKIES_TWITTER` | Nội dung file `cookies-twitter.json` |
| `COOKIES_FACEBOOK` | Nội dung file `cookies-facebook.json` |
| `COOKIES_THREADS` | Nội dung file `cookies-threads.json` |
| `COOKIES_TOPDEV` | Nội dung file `cookies-topdev.json` |
| `COOKIES_ITVIEC` | Nội dung file `cookies-itviec.json` |
| `COOKIES_VERCEL` | Nội dung file `cookies-vercel.json` |
| `GROQ_API_KEY` | Groq API key cho AI validation |
| `CLOUDFLARE_API_KEY` | API key cho Cloudflare integration |

## 6.3 Cài dependencies

```bash
npm install --no-audit
npx playwright install chromium --with-deps
```

## 6.4 Kích hoạt Workflow

1. Vào repo → **Actions** tab
2. Click **"I understand my workflows, go ahead and enable them"**
3. Workflow sẽ tự chạy theo schedule (mỗi 4 giờ)

## 6.5 Chạy thủ công (Test)

1. Actions → **Job Search** workflow
2. Click **"Run workflow"** → **"Run workflow"**
3. Kiểm tra Telegram xem có nhận tin nhắn không

---

## Schedule (UTC+7)

Workflow hiện chạy mỗi 4 giờ theo cron trong repository.

## Xem Logs

1. Actions → Click vào run gần nhất
2. Click **"search-jobs"** → Xem output
3. Artifacts chứa file log chi tiết
