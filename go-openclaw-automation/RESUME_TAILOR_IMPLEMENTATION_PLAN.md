# OpenClaw Resume Tailor - Implementation Plan

## 1. Overview
Hệ thống tự động hóa việc ứng tuyển bằng cách:
1.  Lưu trữ Job đã scrape và thông tin người dùng (Master Resume) vào Database.
2.  Sử dụng AI để tinh chỉnh (tailor) nội dung Resume cho phù hợp với từng Job Description.
3.  Tạo file PDF Resume chuyên nghiệp từ HTML template.
4.  Tương tác qua Telegram Bot.

## 2. Tech Stack Selection
*   **Language**: Go (Golang)
*   **Database**: PostgreSQL 16+ (Hosted on **Neon.tech** - Free Tier).
*   **PDF Engine**: `chromedp` (Headless Chrome) để render HTML -> PDF.
*   **AI Service**: Grok API (xAI) hoặc Gemini Flash 1.5 (Google).
*   **Hosting**: Google Cloud Run (Dockerized).
*   **Architecture Pattern**: Monorepo, Shared Internal Packages.

## 3. Database Schema Design (PostgreSQL)

Chúng ta sẽ cần 3 bảng chính. Sử dụng `JSONB` cho các trường dữ liệu linh động.

### Tables
1.  **`users`**
    *   `id` (UUID, PK)
    *   `telegram_id` (BigInt, Unique)
    *   `username` (Text)
    *   `master_resume_json` (JSONB) - Chứa resume gốc chuẩn JSON Resume standard.
    *   `created_at`, `updated_at`

2.  **`jobs`**
    *   `id` (UUID, PK)
    *   `source` (Text) - Ex: "linkedin", "topcv"
    *   `external_id` (Text) - ID của job trên trang gốc (tránh trùng lặp).
    *   `title` (Text)
    *   `company` (Text)
    *   `description_raw` (Text) - HTML/Text gốc.
    *   `description_summary` (Text) - Tóm tắt ngắn gọn (nếu có).
    *   `url` (Text)
    *   `created_at`

3.  **`applications`**
    *   `id` (UUID, PK)
    *   `user_id` (FK -> users)
    *   `job_id` (FK -> jobs)
    *   `status` (Enum: 'SCANNED', 'TAILORING', 'COMPLETED', 'FAILED')
    *   `tailored_resume_json` (JSONB) - Kết quả sau khi AI sửa.
    *   `match_score` (Int) - Điểm phù hợp (0-100).
    *   `cover_letter` (Text) - AI generated cover letter.
    *   `created_at`

---

## 4. Implementation Steps

### Phase 1: Foundation & Database Setup
- [ ] **Setup Neon.tech**: Tạo account, lấy Connection String.
- [ ] **Migration Tool**: Chọn thư viện (ví dụ: `golang-migrate` hoặc `gorm-automigrate` cho đơn giản lúc đầu).
- [ ] **Refactor Models**: Tạo package `internal/models` chứa các struct Go tương ứng với SQL schema.
- [ ] **Data Migration Script**: Viết script đọc các file JSON cache hiện tại -> Insert vào DB `jobs` table.

### Phase 2: Master Resume System
- [ ] **Define JSON Schema**: Tạo struct Go dựa trên chuẩn [JSONResume.org](https://jsonresume.org/schema/).
- [ ] **User Seeding**: Tạo một file `my_master_resume.json` điền đầy đủ thông tin của bạn.
- [ ] **Import Command**: Viết CLI command để load file này vào bảng `users`.

### Phase 3: The PDF Generator (`internal/pdf`)
- [ ] **Design Template**: Tạo `internal/templates/resume.html` và `style.css`. Thiết kế đẹp, modern (Glassmorphism/Minimalist).
- [ ] **Template Engine**: Sử dụng `html/template` của Go để bind dữ liệu từ JSON Resume Struct vào HTML.
- [ ] **Chromedp Integration**:
    *   Viết hàm `GeneratePDF(htmlContent string) ([]byte, error)`.
    *   Config `chromedp` để in trang A4, bỏ header/footer mặc định.
- [ ] **Local Testing**: Tạo script test gen ra file output.pdf để xem thử.

### Phase 4: AI Brain (`internal/ai`)
- [ ] **AI Client Interface**: Tạo interface để dễ dàng switch giữa Grok, Gemini, OpenAI.
- [ ] **Prompt Engineering**: Viết prompt tối ưu:
    *   INPUT: Master Resume (JSON) + Job Description (Text).
    *   INSTRUCTION: "Giữ nguyên cấu trúc JSON, giữ nguyên history công ty, chỉ viết lại phần 'Summary' và các bullet point trong 'Experience' để match keywords của Job Description."
    *   OUTPUT: JSON (Strict mode).
- [ ] **Parsing**: Viết hàm validate JSON trả về từ AI để đảm bảo không bị lỗi format.

### Phase 5: Telegram Integration & Orchestrator (`cmd/server`)
- [ ] **Setup Web Server**: Dùng `Gin` hoặc `Chi`. Endpoint `/webhook/telegram`.
- [ ] **Webhook Handler**:
    *   Nhận Callback Query (khi bấm nút "Refine CV").
    *   Gửi status "Typing..." hoặc Message "Đang xử lý...".
    *   Trigger Goroutine xử lý background.
- [ ] **Workflow (Background Job)**:
    1.  Get Job & User from DB.
    2.  Call AI -> Get Tailored JSON.
    3.  Save Tailored JSON to DB (`applications` table).
    4.  Render HTML -> PDF.
    5.  Call Telegram API `SendDocument` gửi PDF cho user.

### Phase 6: Deployment (Google Cloud Run via Cloud Build)
- [ ] **Dockerizing**:
    *   Updated `Dockerfile` to build both `scraper` and `server`.
    *   Base image: `mcr.microsoft.com/playwright:v1.40.0-focal` (contains dependencies for headless Chrome).
- [ ] **Cloud Run Configuration (Wait until project completion)**:
    1.  Go to **Cloud Run Console** -> **Create Service**.
    2.  **Source**: Continuously deploy new revisions from a source repository.
    3.  **Repository**: Connect to `openclaw-job-hunter`.
    4.  **Build Configuration**:
        *   **Type**: Dockerfile.
        *   **Source location**: `/go-openclaw-automation` (Crucial: Do not select root `/`).
    5.  **Environment Variables**:
        *   Add secrets from `.env` (LINKEDIN_USERNAME, DB_URL, etc.) into "Variables & Secrets" tab.
    6.  **Resources**:
        *   Memory: Min 1GiB (to support Chrome headless).
        *   CPU: 1 vCPU.
    7.  **Authentication**: Allow unauthenticated invocations (for Telegram Webhook).

> **NOTE:** Deployment is currently PAUSED. We will proceed with local development and testing first. Only trigger the Cloud Run build when the application logic is stable to avoid unnecessary build failures and resource usage.

---

## 5. Timeline Estimate
*   **Tuần 1**: Setup DB, Model Migration, PDF HTML Template (Phần tốn time nhất là chỉnh CSS).
*   **Tuần 2**: PDF Generation Logic, AI Prompt Tuning.
*   **Tuần 3**: API Server, Telegram integration, Debugging.

