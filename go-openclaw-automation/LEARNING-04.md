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

---

## 🏗️ **GO BEST PRACTICE: HELPER FUNCTIONS TRONG `main.go`**

### ❓ **TODO 9: `main.go` có nhiều helper functions — đúng hay sai best practice?**

**Context:** `cmd/scraper/main.go` — các functions `saveJobs()`, `extractExternalID()`

**Trả lời:**

**Sai** với các hàm có thể tái sử dụng. Quy tắc Go chuẩn:

- `main.go` nên **chỉ chứa orchestration logic** (khởi tạo dependencies, gọi các component, điều phối flow).
- Helper functions nên được đặt trong **file riêng trong cùng package** hoặc trong **package riêng** tùy mức độ tái sử dụng.

**3 cấp độ phân tách:**

| Vị trí | Khi nào dùng | Ví dụ |
|---|---|---|
| `cmd/scraper/helpers.go` | Helper nhỏ, chỉ dùng trong package `main` này | `saveJobs()`, `extractExternalID()` |
| `internal/somepackage/` | Logic có thể tái dùng ở nhiều nơi | Filter, Dedup, Scraper |
| `pkg/` | Thư viện dùng được cả ngoài module | Chưa có trong project này |

**Giải pháp đã thực hiện:** Tách `saveJobs()` và `extractExternalID()` vào `cmd/scraper/helpers.go`. Vì chúng chỉ phục vụ riêng cho binary `scraper`, không đặt vào `internal/` (sẽ over-engineer).

---

## 🔑 **DATABASE EXTERNAL ID STRATEGY**

### ❓ **TODO 10: Tại sao dùng `jobURL` làm `external_id` thay vì tạo ID riêng?**

**Context:** `cmd/scraper/helpers.go` — `extractExternalID()`

**Trả lời:**

**Lý do pragmatic:** Các scraper hiện tại không expose job's numeric ID từng platform (e.g., LinkedIn job ID từ URL). URL đã là **canonical identifier** duy nhất cho mỗi listing.

**Tại sao URL hoạt động tốt làm external_id:**
1. URL là unique per job listing (mỗi job có URL riêng).
2. Kết hợp với field `source` trong DB, constraint `UNIQUE(source, external_id)` đảm bảo không insert trùng.
3. URL thường stable — LinkedIn/ITViec không thay đổi URL của listing cũ.

**Khi nào nên cải thiện:**
- Khi scraper có thể parse numeric job ID từ URL:
  - LinkedIn: `https://linkedin.com/jobs/view/4132498735` → ID là `4132498735`
  - ITViec: parse từ slug URL
- Lúc đó dùng numeric ID sẽ ngắn gọn và robust hơn URL đầy đủ.

**Hiện tại:** Dùng URL là acceptable và đúng cho giai đoạn này.

---

## 🐛 **NIL POINTER PANIC: `defer` VỚI POINTER CÓ THỂ NIL**

### ❓ **Bug đặc biệt: Tại sao `defer repo.Close()` ngay sau khi DB lỗi lại crash?**

**Context:** `cmd/scraper/main.go` — DB init block

**Code BUG (đã fix):**
```go
repo, err := database.ConnectDB(...)
if err != nil {
    log.Printf("⚠️ DB not connected") // không fatal, tiếp tục
}
defer repo.Close() // 💥 PANIC nếu ConnectDB trả về nil, repo!
```

**Lý do crash:**

`ConnectDB` trả về `(*Repository, error)`. Khi có lỗi, nó trả về `(nil, error)`.

Khi `main()` return sau đó, Go thực thi `defer repo.Close()`. Nhưng `repo == nil`, nên gọi method trên nil pointer → **nil pointer dereference panic**.

```
goroutine 1 [running]:
main.main()
        runtime error: invalid memory address or nil pointer dereference
```

**Fix đúng:**
```go
repo, err := database.ConnectDB(...)
if err != nil {
    log.Printf("⚠️ DB not connected: %v", err)
} else {
    defer repo.Close() // chỉ defer khi repo thực sự không nil
    log.Println("✅ Database Connected")
}
```

**Bài học:** Luôn guard `defer` với resource acquisition — chỉ defer cleanup khi acquisition thành công. Đây là pattern chuẩn Go cho mọi resource (file, DB connection, mutex lock).

---

## 🌐 **PLAYWRIGHT: `BrowserContext` vs `Page`**

### ❓ **TODO: `BrowserContext` mạnh hơn `Page` hay sao?**

**Context:** `internal/scraper/base.go` — interface `Scraper`

Không phải mạnh hơn — là **layer cao hơn** trong hệ thống phân cấp:

```
Browser (1 process Chromium)
  └── BrowserContext  ← isolated session (cookies, localStorage riêng)
        └── Page      ← 1 tab trong context đó
```

Interface mới nhận `BrowserContext` thay vì `Page` để mỗi scraper **tự tạo tab riêng** → safe cho concurrent. Interface cũ share 1 `Page` → chỉ chạy sequential được.

---

## 🔗 **ERRGROUP: SUPERVISOR CHO GOROUTINES**

### ❓ **TODO: `errgroup` làm gì, tại sao dùng?**

**Context:** `cmd/scraper/main.go`

`errgroup` làm 3 thứ mà raw goroutine không làm được:
1. **`g.Wait()`** — block đến khi tất cả goroutines xong
2. **Error propagation** — collect errors từ mọi goroutine
3. **`gCtx`** — khi 1 goroutine return error, context tự cancel → báo hiệu goroutines khác dừng

Ở đây dùng `return nil` thay vì `return err` để scrapers độc lập — A lỗi không cancel B.

---

## 🔄 **LOOP VARIABLE CAPTURE ĐÃ FIX TỪ GO 1.22**

### ❓ **TODO: `s := s` là gì? Go 1.25 không cần nữa sao?**

**Context:** `cmd/scraper/main.go`

Đây là workaround cho bug lịch sử: trước Go 1.22, tất cả goroutines trong loop share **cùng 1 biến** `s`. Khi goroutine chạy, `s` đã trỏ vào scraper cuối cùng của loop → mọi goroutine scrape cùng 1 platform.

`s := s` tạo variable mới shadow biến loop → mỗi goroutine có bản copy riêng.

**Từ Go 1.22+:** Fix tự động, `s := s` không cần nữa. Kiểm tra version bằng `go version`.

---

## 🎫 **SEMAPHORE TOKEN SYNTAX**

### ❓ **TODO: `chan struct{}` vs `struct{}{}` — sao defer không có `struct{}{}`?**

**Context:** `internal/scraper/topcv/scraper.go`

| Ký hiệu | Vai trò |
|---|---|
| `chan struct{}` | **Kiểu** của channel |
| `struct{}{}` | **Giá trị token** gửi vào channel |
| `<-sem` | **Nhận token** ra (không cần giá trị, bỏ đi) |

`struct{}` chiếm **0 bytes RAM** — lý do dùng thay vì `int`/`bool`.

`defer` phải wrap trong `func()` vì Go chỉ chấp nhận **function call** sau `defer`, không phải expression:
```go
defer func() { <-sem }()  // ✅ Đúng
// defer <-sem             // ❌ Compile error
```

---

## 🐦 **TWITTER SCRAPER: QUERY BUILDING**

### ❓ **TODO: `quotedKeywords` và `keywordPart` là gì?**

**Context:** `internal/scraper/twitter/scraper.go`

Mục đích: từ `["golang", "go developer"]` → build query `"golang" OR "go developer"`.

```go
// Bước 1: Wrap trong dấu ngoặc kép — Twitter search exact phrase khi có ngoặc
quotedKeywords[i] = fmt.Sprintf(`"%s"`, k)
// → ["\"golang\"", "\"go developer\""]

// Bước 2: Nối bằng " OR "
keywordPart := strings.Join(quotedKeywords, " OR ")
// → `"golang" OR "go developer"`

// Bước 3: Lắp vào query hoàn chỉnh
searchQuery := fmt.Sprintf(`(%s) (job OR hiring) ...`, keywordPart)
// → `("golang" OR "go developer") (job OR hiring) (fresher OR junior) -senior`
```

---

## 🔍 **TWEET FILTER: CHECK `err != nil || len(text) < 20`**

### ❓ **TODO: Check này có ý nghĩa gì?**

2 điều kiện độc lập — bỏ qua nếu **một trong hai** đúng:
- `err != nil` → tweet không có text element (ảnh-only, poll, video-only tweet)
- `len(strings.TrimSpace(text)) < 20` → text quá ngắn sau khi trim — tweet emoji-only, reply cụt ("👍", "nice!")

---

## 🎯 **PRE-FILTER vs POST-FILTER PATTERN**

### ❓ **TODO: `!jobKeywordRegex.MatchString(text)` → `continue` — có nên bỏ không?**

**Không bỏ.** Đây là **pre-filter** (lọc trước AI). Logic Twitter có 2 tầng:

1. **Pre-filter** (regex): loại nhanh tweet rõ ràng không liên quan → tiết kiệm AI calls
2. **Post-filter** (`filter.ShouldIncludeJob`): filter chính xác hơn sau AI

Pattern này standard trong data pipeline: **filter sớm, filter thô → filter muộn, filter tinh**.

---

## ✂️ **`Trim` vs `TrimSpace` vs `TrimPrefix`**

### ❓ **TODO: Khác nhau như thế nào?**

| Function | Loại bỏ gì | Input → Output |
|---|---|---|
| `TrimSpace(s)` | Whitespace đầu/cuối (space, tab, `\n`) | `"  hello\n"` → `"hello"` |
| `Trim(s, cutset)` | Các ký tự trong `cutset` đầu/cuối | `Trim("--hi--", "-")` → `"hi"` |
| `TrimPrefix(s, prefix)` | Đúng chuỗi `prefix` ở đầu (nếu có) | `TrimPrefix("/user", "/")` → `"user"` |

Twitter `authorHref` trả về `/username` → `TrimPrefix(authorHref, "/")` → `"username"`.

---

## 🔗 **RELATIVE PATH → ABSOLUTE URL**

### ❓ **TODO: `jobURL = "https://x.com"` default rồi lại gán trong if là sao?**

```go
jobURL := "https://x.com"           // Fallback khi không có tweetHref
if tweetHref != "" {
    jobURL = "https://x.com" + tweetHref  // Override: ghép domain + relative path
}
```

Twitter DOM trả về `href` là **relative path**: `/username/status/123456789` (không có domain).
Cần ghép `"https://x.com"` vào đầu để ra URL đầy đủ.

Không dùng `+=` vì `jobURL` ban đầu là `"https://x.com"` → `+=` sẽ cho `"https://x.com/username/status/..."` chỉ khi `tweetHref` có giá trị. Kết quả giống nhau, nhưng pattern gán lại rõ ràng hơn về intent: "nếu có thì dùng cái này, không thì fallback".

---

## 📐 **FORMAT VERB `%.Ns` — TRUNCATE STRING**

### ❓ **TODO: `%.40s` là gì? Khác `%.2f` ở chỗ nào?**

`.N` trong format verb có nghĩa khác tùy **type**:

| Verb | Ý nghĩa của `.N` |
|---|---|
| `%.2f` | 2 chữ số thập phân |
| `%.40s` | Tối đa 40 ký tự (truncate string) |

```go
log.Printf("%.40s", "Hello World this is a very long string")
// Output: "Hello World this is a very long string"  (< 40 chars, không cắt)

log.Printf("%.10s", "Hello World this is a very long string")
// Output: "Hello Worl"  (cắt ở ký tự thứ 10)
```

Các width verbs khác của `%s`:
| Verb | Ý nghĩa |
|---|---|
| `%10s` | Pad LEFT đến 10 ký tự (right-align) |
| `%-10s` | Pad RIGHT đến 10 ký tự (left-align) |
| `%.10s` | TRUNCATE xuống tối đa 10 ký tự |
