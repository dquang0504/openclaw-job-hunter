# 📚 LEARNING-04 - Browser Stealth, Deduplication & Concurrency Safety

---

## 🛡️ **BROWSER STEALTH: CHROME LAUNCH ARGS**

### ❓ **TODO 1+2: Các tham số trong `Args` và `IgnoreDefaultArgs` có ý nghĩa gì?**

**Context:** `internal/browser/playwright.go` — `NewPlaywright()` function.

**Trả lời — từng flag:**

| Flag | Ý nghĩa |
|---|---|
| `--no-sandbox` | Tắt Chrome sandbox. Cần thiết trong Docker/GitHub Actions vì sandbox yêu cầu `setuid` privilege mà container không có. |
| `--disable-setuid-sandbox` | Tắt sandbox layer thứ 2. Kết hợp với `--no-sandbox` để đảm bảo không crash trong CI. |
| `--disable-blink-features=AutomationControlled` | **⭐ Cái quan trọng nhất.** Tắt flag nội bộ Chrome báo hiệu website rằng "browser này đang bị automation điều khiển". Thiếu cái này, `navigator.webdriver` sẽ return `true` và sites như Facebook/Cloudflare sẽ block ngay. |
| `--disable-infobars` | Ẩn thanh thông báo vàng "Chrome is being controlled by automated test software". |
| `--window-size=1280,800` | Set kích thước cửa sổ giả lập màn hình laptop thực. |
| `--disable-accelerated-2d-canvas` | Tắt hardware acceleration cho canvas 2D. Giúp tránh crash và canvas fingerprint bất thường trong CI. |
| `--disable-gpu` | Tắt GPU rendering. Bắt buộc trong môi trường CI vì không có GPU thực. |
| `--no-first-run` | Bỏ qua màn hình "Welcome/Setup" lần đầu mở Chrome. |
| `--no-service-autorun` | Tắt auto-start các service background của Chrome. |
| `--password-store=basic` | Dùng password store đơn giản, tránh dialog keychain popup làm treo browser. |

**`IgnoreDefaultArgs: ["--enable-automation"]`:**

Playwright **mặc định tự thêm** flag `--enable-automation` vào Chrome. Flag này làm cho `navigator.webdriver = true`, lộ bot với mọi anti-detection system.

`IgnoreDefaultArgs` là cách **override** để xóa đúng flag đó ra khỏi danh sách mặc định của Playwright — chỉ xóa flag đó, giữ lại các flag mặc định hữu ích khác.

---

## 🕵️ **BROWSER CONTEXT: USER-AGENT STRING**

### ❓ **TODO 3: Các thành phần trong UserAgent string có ý nghĩa gì?**

**Context:** `internal/browser/playwright.go` — `NewContext()` function.

**UA String:** `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36`

**Phân tích từng phần:**

| Thành phần | Ý nghĩa |
|---|---|
| `Mozilla/5.0` | Tiền tố lịch sử. Hầu như mọi browser đều giữ để tương thích ngược với server cũ. |
| `Windows NT 10.0; Win64; x64` | **Quan trọng:** Giả lập hệ điều hành Windows 10, 64-bit. Nếu lộ Linux/Server OS, site có thể detect ra datacenter/bot. |
| `AppleWebKit/537.36` | Khai báo rendering engine (Blink của Chrome, fork từ WebKit của Safari). |
| `(KHTML, like Gecko)` | Compatibility token, báo browser có thể render như Gecko (Firefox engine). Giữ cho các site cũ không bị lỗi. |
| `Chrome/121.0.0.0` | Khai báo phiên bản Chrome 121. |
| `Safari/537.36` | Token cuối để nhận diện browser family. |

**Tại sao chọn Chrome/121?** — Phiên bản "stable, không quá cũ, không quá mới" tại thời điểm viết code. Version quá cũ bị flag là outdated client (dấu hiệu bot), version quá mới có thể không khớp với fingerprint thực của browser.

---

## 🔒 **CONCURRENCY SAFETY: MUTEX TRONG MAP**

### ❓ **TODO 4a: Tại sao cần `mutex.Lock()` trong `IsSeen()` - chỉ để đọc thôi mà?**

**Context:** `internal/dedup/dedup.go` — `IsSeen()` function.

**Trả lời:**

Map trong Go **KHÔNG thread-safe**. Nếu 2 goroutine đọc/ghi map cùng lúc (dù chỉ 1 cái đọc và 1 cái ghi), chương trình sẽ **panic ngay lập tức** với lỗi:

```
fatal error: concurrent map read and map write
```

Dù hiện tại scrapers chạy tuần tự (sequential), dùng mutex ở cả `IsSeen` (read) và `Add` (write) là **Go best practice** để:
1. An toàn ngay bây giờ.
2. Khi sau này thêm concurrency (nhiều scraper chạy song song bằng goroutine), code không bị crash.

**Cơ chế:**
- `mu.Lock()` → Goroutine hiện tại "khóa" map, các goroutine khác phải chờ.
- `defer mu.Unlock()` → Tự động mở khóa khi function return (dù return bình thường hay panic).

---

### ❓ **TODO 4b: Tại sao `load()` lại set `seen[url] = timestamp` - tôi tưởng đã seen rồi thì mới load cache?**

**Context:** `internal/dedup/dedup.go` — `load()` function.

**Trả lời:**

Đây là pattern **"in-memory cache backed by disk"** (cache RAM được hỗ trợ bởi file disk).

**Luồng hoạt động:**

```
Khởi động app
    │
    ▼
seen map (RAM) = {} ← TRỐNG sau mỗi lần run
    │
    ▼
load() đọc seen_jobs.json từ DISK
    │
    ▼
Populate RAM: seen["url1"] = timestamp1
              seen["url2"] = timestamp2
    │
    ▼
IsSeen("url1") → check RAM (nhanh O(1), không cần đọc disk)
    │
    ▼
Add(["url3"]) → update RAM + ghi lại DISK ngay lập tức
```

**Tóm lại:** `seen` map là bản **copy trong RAM** của file disk. `load()` có nhiệm vụ sync từ disk → RAM khi app khởi động. Việc "đã seen" là trạng thái được lưu trong file, còn trong RAM là 0 sau mỗi lần khởi động lại.

---

## 🔗 **URL NORMALIZATION IN WEB SCRAPING**

### ❓ **TODO 5: Tại sao không append fullUrl luôn mà phải split theo dấu `?`?**

**Context:** `internal/scraper/linkedin/scraper.go`

**Trả lời:**

Các nền tảng tuyển dụng như LinkedIn thường gắn thêm các **query parameters** (tham số theo dõi) vào URL của job để tracking nguồn gốc traffic.

Ví dụ cùng một job, nhưng URL có thể khác nhau tùy thời điểm hoặc người click:
- `https://linkedin.com/jobs/view/123456?refId=abc&trackingId=xyz`
- `https://linkedin.com/jobs/view/123456?refId=def&trackingId=mno`

Nếu giữ nguyên cả chuỗi, hệ thống deduplication (loại bỏ trùng lặp) sẽ coi đây là **2 job khác nhau**, dẫn đến việc spam tin nhắn trùng lặp.

Việc `strings.Split(fullUrl, "?")[0]` giúp lấy về URL gốc (canonical URL):
- `https://linkedin.com/jobs/view/123456`

Điều này đảm bảo tính duy nhất cho mỗi job trong database/cache của chúng ta.

---

## 💬 **TELEGRAM BOT: MARKDOWN & FORMATTING**

### ❓ **TODO 6: Ý nghĩa của các ký hiệu trong `escapeMarkdown` là gì?**

**Context:** `internal/telegram/bot.go` — `escapeMarkdown()`

**Trả lời:**

Telegram gửi tin nhắn dưới dạng `MarkdownV2`. Parse mode này **bắt buộc** mọi ký tự đặc biệt có thể mang ý nghĩa format phải được escape bằng dấu `\` nếu nó nằm trong một chuỗi bình thường (để tránh lỗi parse của Telegram).

Các ký tự được đưa vào vòng lặp `replace` bao gồm:
`_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`

**Ví dụ:**
- Cú pháp in đậm: `*Hello*` -> nếu text là `Node.js & C*` thì nó sẽ lỗi vì không có dấu `*` đóng đóng. Do đó ta escape: `Node\.js & C\*`.
- Nếu công ty là: `Viet-Tech, Inc.` => output xử lý escape: `Viet\-Tech, Inc\.`

---

### ❓ **TODO 7: Tại sao lại check `Source == Facebook` khi in ra description?**

**Context:** `internal/telegram/bot.go` — `SendJob()`

**Trả lời:**

Đây là một "đặc sản" của việc crawl dữ liệu từ **Mạng Xã Hội (Facebook, Threads, LinkedIn Post)** so với các trang Job Portal truyền thống (TopCV, ITViec).

- **Job Portal**: Thường có link JD cụ thể, ứng viên chỉ cần bấm "View Job" để đọc. Description gửi qua tele dài dòng là không cần thiết.
- **Mạng Xã Hội**: Thường được post dưới dạng bài đăng của HR. Có link nhưng bấm vào nó ném ra link... feed của người ta (nhiều khi lỗi). Do đó hiển thị thêm `Description` ngay trên Telegram để người dùng lấy thông tin liên hệ như email ứng tuyển luôn mà không cần vào Link nữa. 

Trong source nodejs ban đầu có xử lý case cho Facebook/LinkedIn Post là vì lẽ này. Các port từ Nodejs đều giữ nguyên logic này.

---

### ❓ **TODO 8: Ý nghĩa của "trạng thái tổng kết" trong `SendStatus`?**

**Context:** `internal/telegram/bot.go` — `SendStatus()`

**Trả lời:**

Trạng thái tổng kết (Telemetry/Notification) là kiểu báo cáo "Report" tổng thể sau cả một lô chạy automation script hoàn tất thay vì từng job một.

**Ví dụ thực tế đã có trong luồng làm việc:**
Thay vì chỉ gửi lẻ tẻ "Bạn có Job A", "Bạn có Job B", khi kết thúc quá trình script search job vào cuối ngày, `main.go` gọi `bot.SendStatus()` để chốt lại:

`ℹ️ Tìm được 50 jobs mới valid, đã gửi 8 jobs.`

Điều này giúp user nắm bắt được bot có đang hoạt động mượt không và lượng thông tin ra sao, không bị im lặng đáng sợ.
