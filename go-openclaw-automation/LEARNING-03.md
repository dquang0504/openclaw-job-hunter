# 📚 LEARNING-03 - Playwright in Go: Common Pitfalls & Best Practices

Tài liệu này giải thích các vấn đề thường gặp khi migration từ Node.js Playwright sang Go Playwright.

---

## 🎭 **PLAYWRIGHT CONFIGURATION**

### ❓ **TODO 1: Tại sao dùng `playwright.Bool(true)` mà không dùng `true`?**

**Trả lời:**

Trong Go, fields của `struct` options thường là **pointer** (`*bool`, `*string`, `*int`) chứ không phải primitive values trực tiếp.

#### **Vì sao cần Pointer?**

Để phân biệt giữa **"không set giá trị"** (nil) và **"set giá trị là false/empty"** (zero value).

**Ví dụ:**
```go
type Options struct {
    Headless *bool // Pointer
}
```

- Nếu `Headless` là `nil` → Dùng default của library (ví dụ: `true` cho headless).
- Nếu `Headless` là pointer to `false` → Force headful mode.
- Nếu `Headless` là pointer to `true` → Force headless mode.

#### **Code minh họa:**

**❌ SAI (Compile Error):**
```go
// Error: cannot use true (untyped bool constant) as *bool value
options := playwright.BrowserTypeLaunchOptions{
    Headless: true, 
}
```

**✅ ĐÚNG (Helper Function):**
```go
// Helper: func Bool(v bool) *bool { return &v }
options := playwright.BrowserTypeLaunchOptions{
    Headless: playwright.Bool(true),
}
```

**✅ ĐÚNG (Manual Pointer - rườm rà):**
```go
val := true
options := playwright.BrowserTypeLaunchOptions{
    Headless: &val,
}
```

---

## 🍪 **COOKIE HANDLING**

### ❓ **TODO 2: Sửa lỗi `cannot use ... in call to non-variadic ctx.AddCookies`?**

**Trả lời:**

Lỗi này do bạn dùng **variadic syntax** (`...`) cho một hàm nhận vào **slice** (`[]T`).

#### **Nguyên nhân:**

Trong Go:
- **Variadic function:** `func Foo(args ...int)` → Gọi là `Foo(1, 2, 3)` hoặc `Foo(slice...)`.
- **Slice parameter:** `func Bar(args []int)` → Gọi là `Bar(slice)`.

Hàm `ctx.AddCookies` trong `playwright-go` được define là:
```go
func (c *BrowserContext) AddCookies(cookies []Cookie) error
```
→ Nó nhận vào **một slice**, KHÔNG phải variadic list.

#### **Cách sửa:**

**❌ SAI (Logic cũ):**
```go
// Tưởng là AddCookies(c1, c2, c3...)
err = ctx.AddCookies(cookies...)
```

**✅ ĐÚNG (Fix):**
```go
// Pass nguyên slice vào
err = ctx.AddCookies(cookies)
```

---

## 📂 **FILE & PATH HANDLING**

### ❓ **TODO 3: Tại sao dùng `filepath.Join` mà không dùng string concatenation?**

**Trả lời:**

`filepath.Join` là cách **cross-platform** (đa nền tảng) để nối đường dẫn file.

#### **Lý do:**

1.  **Dấu phân cách khác nhau:**
    *   **Windows:** Dùng backslash `\` (vd: `C:\Users\Name`)
    *   **Linux/macOS:** Dùng forward slash `/` (vd: `/home/user`)

    Nếu bạn hardcode: `"../.cookies/file.json"`, nó có thể chạy trên Linux nhưng lỗi trên Windows (hoặc ngược lại).

2.  **Clean path:**
    *   `filepath.Join("a", "//b//", "c")` → `a/b/c` (tự động xóa dấu `/` thừa).

#### **Code minh họa:**

**❌ SAI (Hardcoded - Rủi ro):**
```go
path := "..\\.cookies\\cookies.json" // Chỉ chạy trên Windows
```

**✅ ĐÚNG (Cross-platform):**
```go
// Tự động dùng '/' trên Linux và '\' trên Windows
path := filepath.Join("..", ".cookies", "cookies.json")
```

---

## ⚡ **CONCURRENCY: SEQUENTIAL VS CONCURRENT**

### ❓ **TODO 4: Vòng for scrapers đang chạy Sequential? Có nên chạy Concurrent không?**

**Trả lời:**

Đúng, vòng lặp `for _, s := range scrapers` hiện tại đang chạy **Sequential** (Tuần tự - chạy xong scraper 1 mới tới scraper 2).

#### **Có nên chạy Concurrent (Song song)?**

**CÓ, RẤT NÊN!** Go nổi tiếng với Go Routines, giúp xử lý song song cực nhẹ.

#### **Cách implement Concurrent Scraping:**

Dùng `sync.WaitGroup` và `channel` để thu thập kết quả.

```go
import "sync"

// ...

var wg sync.WaitGroup
jobChan := make(chan []scraper.Job, len(scrapers))

for _, s := range scrapers {
    wg.Add(1)
    
    // Launch Go Routine
    go func(sc scraper.Scraper) {
        defer wg.Done()
        
        log.Printf("▶️ Starting scraper: %s", sc.Name())
        // Lưu ý: Cần xử lý Page riêng cho mỗi routine nếu không thread-safe!
        // Trong Playwright, Page KHÔNG thread-safe. 
        // Best practice: Tạo NewPage cho mỗi scraper hoặc chạy tuần tự trong 1 Page.
        
        // Nếu dùng chung 1 Page: NGUY HIỂM (Race condition) ❌
        // jobs, err := sc.Scrape(ctx, page) 
        
        // Giải pháp: 
        // 1. Mỗi scraper tự tạo page (Cần truyền BrowserContext vào thay vì Page)
        // 2. Hoặc chạy tuần tự (An toàn nhất nếu resource hạn chế)
        
        // Giả sử Scrape tự handle page hoặc dùng page riêng:
        // jobChan <- jobs
    }(s)
}

// Wait & Collect
go func() {
    wg.Wait()
    close(jobChan)
}()

var allJobs []scraper.Job
for jobs := range jobChan {
    allJobs = append(allJobs, jobs...)
}
```

#### **⚠️ Lưu ý quan trọng với Playwright:**

*   **Page Object không thread-safe:** Bạn KHÔNG THỂ dùng 1 biến `page` cho nhiều go routine cùng lúc (nó sẽ crash hoặc behavior không đoán được).
*   **Giải pháp:**
    1.  Mỗi Scraper nhận vào `BrowserContext` và tự tạo `Page` riêng.
    2.  Hoặc Scraper chạy tuần tự (Sequential) như hiện tại (An toàn, dễ debug, ít tốn RAM).

**Khuyến nghị cho hiện tại:** Giữ **Sequential** để ổn định logic trước. Khi nào cần speed up (nhiều scraper chạy lâu) thì refactor sang Concurrent với `Page` riêng biệt.

---

## 🧮 **ALGORITHM & COMPLEXITY**

### ❓ **TODO 5: Vòng lặp lồng nhau (Keywords x Experience Levels) có tối ưu không?**

**Trả lời:**

Hiện tại, bạn đang dùng 2 vòng lặp lồng nhau:
```go
for _, keyword := range s.cfg.Keywords { // Outer loop: N keywords
    for _, exp := range expLevels {      // Inner loop: M levels (3)
        // ...
    }
}
```
Độ phức tạp là **O(N * M)**.
*   **M = 3** (cố định: 1, 2, 3).
*   **N** là số lượng keywords (thường nhỏ, < 50).

**Tại sao vẫn chấp nhận được?**
1.  **I/O Bound, không phải CPU Bound:** Thời gian chạy chủ yếu là do `page.Goto` (network request) và chờ tải trang (DOM), mất hàng giây. Việc lặp 3 hay 30 lần trong CPU chỉ mất vài micro-giây, không đáng kể so với Network Latency.
2.  **Logic nghiệp vụ:** TopCV yêu cầu tách biệt request để lấy chính xác job theo từng level kinh nghiệm. Không có API "search all levels at once" public mà trả về đầy đủ data phân loại sẵn tiện lợi như vậy.

**Cách tối ưu (nếu cần thiết):**
*   **Concurrent Requests:** Thay vì chạy tuần tự (Sequential), bạn có thể spawn Go Routines để fetch song song các URL này.
    *   Tốc độ: Tăng gấp M lần (nếu máy chịu nổi tải).
    *   Rủi ro: Bị chặn (Rate Limit / WAF) vì gửi quá nhiều request cùng lúc từ 1 IP.

**Kết luận:** Với số lượng nhỏ và để tránh bị block, **Sequential Loop** (O(N*M)) hiện tại là **An toàn và Tốt nhất**.

---

## 🐌 **SLUGIFY UTILITY**

### ❓ **TODO 6: Slugify là gì? Tại sao cần `strings.ReplaceAll`?**

**Trả lời:**

**Slug** là phần định danh duy nhất của một trang web nằm ở cuối URL, thường ở dạng dễ đọc cho con người và SEO-friendly.
*   Ví dụ: `https://topcv.vn/viec-lam/golang-developer` -> `golang-developer` là slug.

**Slugify** là quá trình biến một chuỗi văn bản bình thường thành slug.
Các quy tắc thường gặp:
1.  Chuyển thành chữ thường (Lowercase).
2.  Thay thế khoảng trắng (Space) bằng dấu gạch ngang (`-`).
3.  Loại bỏ các ký tự đặc biệt (dấu câu, v.v.).
4.  Chuyển tiếng Việt có dấu thành không dấu (VD: "Lập Trình Viên" -> "lap-trinh-vien").

**Trong code của bạn:**
```go
// Keyword gốc: "Golang Developer"
// 1. Lowercase: "golang developer"
// 2. Replace Space: "golang-developer"
slug := strings.ReplaceAll(strings.ToLower(keyword), " ", "-")
```
Để tạo ra URL hợp lệ mà TopCV server hiểu được: `.../tim-viec-lam-golang-developer...`. Nếu để nguyên khoảng trắng, URL sẽ lỗi hoặc bị encode thành `%20` xấu xí và có thể server không route đúng.

---

## ⚡ **PERFORMANCE: GO VS NODE.JS & GOROUTINES**

### ❓ **TODO 7: Goroutine trong TopCV Scraper có giúp tăng tốc không?**

**Trả lời:**

*   **Về lý thuyết:** Có thể tăng tốc vì bạn thực hiện các HTTP requests song song.
*   **Thực tế với TopCV:** **KHÔNG NÊN** dùng Goroutine song song cho 3 request kinh nghiệm (Exp 1, 2, 3) trên cùng một `Page`.
    *   **Lý do:** `playwright.Page` **KHÔNG Thread-Safe**. Nếu bạn gọi `page.Goto` ở 3 goroutines khác nhau trên cùng 1 biến `page`, code sẽ crash hoặc behavior loạn xạ.
    *   **Giải pháp:** Muốn song song, bạn phải spawn 3 `Page` (Tabs) riêng biệt. Điều này tốn RAM hơn nhiều.
    *   **Rate Limit:** Gửi 3 requests cùng lúc liên tục dễ bị Cloudflare block hơn là gửi tuần tự từ tốn.

### ❓ **TODO 8: GitHub Actions có chạy được Goroutines không?**

**Trả lời:**

*   **CÓ.** GitHub Actions runner (Linux standard) hỗ trợ đa luồng bình thường. Go runtime sẽ tự động tận dụng số core CPU có sẵn (thường là 2-core trên standard runner).

### ❓ **TODO 9: So sánh Performance: Go vs Node.js**

| Tiêu chí | Go (Dự kiến) | Node.js (V8) |
| :--- | :--- | :--- |
| **Startup Time** | Nhanh hơn (Binary native) | Chậm hơn (Phải load Node VM) |
| **Memory** | Thấp hơn (Quản lý mem tĩnh tốt hơn) | Cao hơn (Mỗi object JS tốn overhead) |
| **Parsing HTML** | Rất nhanh (Native string ops) | Nhanh (Optimized V8) |
| **Scraping (I/O)** | Tương đương (Phụ thuộc vào mạng/Playwright) | Tương đương |
| **Concurrency** | **Vượt trội** (Goroutines nhẹ hơn Async/Await) | Tốt (Event Loop check IO) |

**Kết luận:**
*   Ở quy mô nhỏ (1-2 scraper), bạn sẽ khó thấy khác biệt lớn về tốc độ scrape (vì nghẽn cổ chai là Network).
*   Tuy nhiên, Go sẽ dùng **ít RAM** hơn và **ổn định** hơn (Type safe, ít runtime error ngớ ngẩn).
*   Khi scale lên hàng chục scraper chạy song song, Go sẽ thể hiện sức mạnh vượt trội nhờ Goroutines quản lý hàng nghìn luồng nhẹ nhàng.

---

## 🏗️ **FILE OPERATIONS & JSON**

### ❓ **TODO 10: `os.MkdirAll(logDir, 0755)` - Số 0755 có ý nghĩa gì?**

**Trả lời:**

Đây là **Unix File Permission Mode** (dạng bát phân - Octal).

*   **0** ở đầu: Biểu thị số hệ bát phân.
*   **7** (Owner - Bạn): `rwx` (Read + Write + Execute) → Bạn được toàn quyền (4+2+1=7).
*   **5** (Group): `r-x` (Read + Execute) → Nhóm chỉ được đọc và truy cập folder.
*   **5** (Others - Người khác): `r-x` (Read + Execute) → Người lạ chỉ được đọc.

**Tại sao dùng 0755 cho folder?**
Để folder có thể được truy cập (`cd` vào được - cần quyền execute) bởi mọi user, nhưng chỉ có bạn (owner) mới xóa hoặc thêm file vào được. Đây là permission chuẩn cho thư mục.

### ❓ **TODO 11: `os.WriteFile(..., 0644)` - Số 0644 có ý nghĩa gì?**

**Trả lời:**

Tương tự như trên:

*   **6** (Owner): `rw-` (Read + Write) → Bạn được đọc và sửa file.
*   **4** (Group): `r--` (Read only).
*   **4** (Others): `r--` (Read only).

**Tại sao dùng 0644 cho file?**
File dữ liệu (như JSON) không cần quyền Execute (chạy), nên bỏ bit `x` (1). Đây là permission chuẩn cho file text/data.

### ❓ **TODO 12: `json.MarshalIndent` vs `json.Marshal`?**

**Trả lời:**

1.  **`json.Marshal(v)`**:
    *   Output:  (Compact - 1 dòng duy nhất).
    *   Ưu điểm: Tiết kiệm dung lượng disk/network.
    *   Nhược điểm: Khó đọc bằng mắt thường.

2.  **`json.MarshalIndent(v, "", " ")`**:
    *   Output: (Pretty Print)
        
    *   Tham số 2 (): Prefix mỗi dòng (thường để trống).
    *   Tham số 3 (): Thụt đầu dòng (Indent) bằng 1 khoảng trắng (hoặc 2/4/Tab tùy ý).
    *   Ưu điểm: Dễ debug, con người đọc được.
    *   **Lý do dùng:** File log này dành cho bạn kiểm tra kết quả, nên cần dễ đọc.

---

## 📢 **TELEGRAM & STRUCT POINTERS**

### ❓ **TODO 13: Tại sao truyền pointer thay vì type?**

**Trả lời:**

1.  **Performance (Hiệu năng):**
    *   Trong Go, mọi thứ được truyền bằng giá trị (**Pass by Value**).
    *   Nếu truyền  (struct), Go sẽ **copy toàn bộ dữ liệu** của struct đó vào một vùng nhớ mới cho function. Nếu struct lớn, việc này tốn RAM và CPU.
    *   Nếu truyền  (pointer), Go chỉ copy **địa chỉ bộ nhớ** (8 bytes trên 64-bit OS), cực nhẹ.

2.  **Shared State (Chia sẻ trạng thái):**
    *   Nếu bạn muốn function thay đổi giá trị gốc của struct, BẮT BUỘC phải dùng pointer.
    *   Nếu chỉ đọc (như ), dùng pointer giúp tránh copy thừa.

**Quy tắc ngón tay cái:** Struct nhỏ (vài field int/bool) -> Pass by Value. Struct lớn hoặc cần sửa -> Pass by Pointer.

### ❓ **TODO 14: %w trong fmt.Errorf là gì?**

**Trả lời:**

 (VIết tắt của **Wrap**) là verb đặc biệt được giới thiệu trong Go 1.13 để **bọc lỗi (Error Wrapping)**.

*   Ví dụ:
    

*   **Tác dụng:**
    Giúp giữ lại lỗi gốc bên trong. Bạn có thể dùng  hoặc  để kiểm tra nguyên nhân gốc rễ sau này (unwrap).
    Nếu dùng , lỗi gốc sẽ bị convert thành string và mất khả năng check type.

### ❓ **TODO 15:  có phải là method của class không?**

**Trả lời:**

**Chính xác!** (Nhưng Go gọi là **Struct Method** thay vì Class Method).

*    đóng vai trò như **Class**.
*    là **Instance Method**.
*    đóng vai trò như **Constructor**.

Trong đó  được gọi là **Receiver**. Nó cho phép function truy cập vào các field của struct  (như , ).



---

## 🔡 **UNICODE NORMALIZATION**

### ❓ **TODO 16: Hàm `normalizeText` hoạt động như thế nào? Các package `transform`, `norm` để làm gì?**

**Trả lời:**

Hàm `normalizeText` dùng để **chuẩn hóa chuỗi** (đặc biệt là Tiếng Việt) về dạng không dấu, chữ thường, để dễ dàng so sánh tìm kiếm keyword.

**Giải thích từng dòng:**

1.  **`t := transform.Chain(...)`**:
    *   Tạo ra một transformer pipeline, chạy lần lượt các bước biến đổi.

2.  **`norm.NFD` (Normalization Form Decomposition)**:
    *   Tách ký tự có dấu thành ký tự gốc + dấu.
    *   Ví dụ: "é" (1 ký tự) -> "e" + "´" (2 ký tự riêng biệt).

3.  **`runes.Remove(runes.In(unicode.Mn))`**:
    *   Loại bỏ tất cả các ký tự thuộc nhóm `Mn` (Mark, nonspacing) - chính là các dấu (sắc, huyền, hỏi, ngã, nặng, mũ...).
    *   Sau bước này: "e" + "´" -> "e".

4.  **`norm.NFC` (Normalization Form Composition)**:
    *   Gộp các ký tự lại (bước này chủ yếu để an toàn, đảm bảo chuỗi kết quả chuẩn UTF-8).

5.  **`transform.String(t, str)`**:
    *   Thực thi chuỗi biến đổi `t` lên string đầu vào.

6.  **`strings.ToLower(result)`**:
    *   Chuyển tất cả thành chữ thường.

**Ví dụ:**
*   Input: "Lập Trình Viên Go"
*   NFD: "L" + "a" + "^" + "." + "p" ...
*   Remove Mn: "L" + "a" + "p" ...
*   ToLower: "lap trinh vien go"

**Tại sao cần thiết?**
Để keyword "Golang" có thể khớp với "Gôlang", "GOLANG", hay "gOlAnG" một cách chính xác nhất.

---

## 🎲 **RANDOM DELAY & HELPER FUNCTIONS**

### ❓ **TODO 17: Giải thích `rand.Intn(max-min) + min`? Hàm này có nên là Helper không?**

**Trả lời:**

**1. Giải thích công thức Random Range:**
Để tạo một số ngẫu nhiên trong khoảng `[min, max)` (bao gồm min, không bao gồm max):
*   `rand.Intn(n)` trả về số nguyên ngẫu nhiên trong khoảng `[0, n)`.
*   Đặt `n = max - min`. Khi đó `rand.Intn(max - min)` trả về giá trị trong khoảng `[0, max - min)`.
*   Cộng thêm `min`: `rand.Intn(max - min) + min` sẽ trả về giá trị trong khoảng `[0 + min, (max - min) + min)` = `[min, max)`.

**Ví dụ:**
Muốn delay từ 1000ms đến 2000ms:
*   `min = 1000`, `max = 2000`.
*   `rand.Intn(2000 - 1000)` -> `rand.Intn(1000)` (trả về 0..999).
*   Cộng 1000 -> Kết quả từ 1000..1999.

**2. Refactoring thành Helper/Util:**
*   **TUYỆT ĐỐI NÊN.**
*   Các hàm như `RandomDelay`, `SmoothScroll` là các logic chung (Generic logic) có thể dùng cho mọi Scraper (TopCV, ITviec, LinkedIn...).
*   **Best Practice:** Đưa chúng vào package `utils` hoặc `pkg/browser` để tái sử dụng, giữ cho code của từng scraper gọn gàng và tập trung vào business logic riêng biệt.
*   Việc này tuân thủ nguyên tắc **DRY (Don't Repeat Yourself)**.

**Implementation (trong `utils/stealth.go`):**
```go
package utils

import (
    "math/rand"
    "time"
    "github.com/playwright-community/playwright-go"
)

func RandomDelay(min, max int) {
    // ...
}

func SmoothScroll(page playwright.Page) {
    // ...
}
```

---

## 📁 **FILE OPERATIONS: MKDIR VS MKDIRALL**

### ❓ **TODO 18: `os.Mkdir` khác gì `os.MkdirAll`? Tại sao dùng `MkdirAll`?**

**Trả lời:**

| Function | Chức năng | Ví dụ |
|----------|-----------|-------|
| `os.Mkdir(path, perm)` | Tạo **1 thư mục duy nhất**. Nếu parent directory chưa tồn tại → **LỖI** | `os.Mkdir("a/b/c", 0755)` → Lỗi nếu `a/` hoặc `a/b/` chưa có |
| `os.MkdirAll(path, perm)` | Tạo **toàn bộ cây thư mục** (giống `mkdir -p` trong Linux) | `os.MkdirAll("a/b/c", 0755)` → Tự động tạo `a/`, `a/b/`, `a/b/c/` |

**Tại sao dùng `MkdirAll` trong Screenshot Debugger?**
- Path là `./logs/screenshots`, có thể cả `logs/` lẫn `screenshots/` đều chưa tồn tại.
- Dùng `MkdirAll` đảm bảo tạo đủ cả 2 cấp thư mục mà không cần check từng cái.
- An toàn hơn: Nếu folder đã tồn tại, `MkdirAll` không báo lỗi (idempotent).

**Code minh họa:**
```go
// ❌ SAI - Sẽ lỗi nếu logs/ chưa tồn tại
os.Mkdir("./logs/screenshots", 0755)

// ✅ ĐÚNG - Tự động tạo logs/ và screenshots/
os.MkdirAll("./logs/screenshots", 0755)
```

---

## ⏰ **TIME FORMATTING IN GO**

### ❓ **TODO 19: Tại sao format là `2006-01-02_15-04-05`? Chỉ thấy `2006-01-02` thôi?**

**Trả lời:**

Go dùng **Reference Time** để format thời gian. Reference time là: **`Mon Jan 2 15:04:05 MST 2006`**.

Mỗi thành phần có ý nghĩa cố định:
- `2006` → Năm (Year)
- `01` → Tháng (Month)
- `02` → Ngày (Day)
- `15` → Giờ 24h (Hour)
- `04` → Phút (Minute)
- `05` → Giây (Second)
- `MST` → Timezone

**Ví dụ:**
```go
now := time.Now()

now.Format("2006-01-02")          // "2026-02-17" (chỉ ngày)
now.Format("2006-01-02_15-04-05") // "2026-02-17_07-56-30" (ngày + giờ)
now.Format("15:04:05")            // "07:56:30" (chỉ giờ)
now.Format("02/01/2006 03:04 PM") // "17/02/2026 07:56 AM" (12h format)
```

**Tại sao dùng `_15-04-05` trong screenshot filename?**
1. **Unique filename**: Tránh ghi đè nếu chụp nhiều lần trong cùng 1 ngày.
2. **Cross-platform**: Dùng `_` và `-` thay vì `:` vì `:` không hợp lệ trong tên file trên Windows.
3. **Sortable**: Format này giúp file tự động sắp xếp theo thời gian khi list directory.

**Mẹo nhớ Reference Time:**
"1 2 3 4 5 6 7" → Month=1, Day=2, Hour=3PM (15h), Minute=4, Second=5, Year=2006, Timezone=7 (MST=-7)

---

## 🎭 **HEADLESS MODE IN PLAYWRIGHT**

### ❓ **TODO 20: `Headless` là gì? `nil` vs `true` vs `false`?**

**Trả lời:**

| Giá trị | Hành vi | Use Case |
|---------|---------|----------|
| `nil` (không set) | Dùng **default của Playwright** (thường là `true` - headless) | Production, CI/CD |
| `playwright.Bool(true)` | **Headless** - Không hiện cửa sổ browser, chạy ngầm | Production, Server, GitHub Actions |
| `playwright.Bool(false)` | **Headful** - Hiện cửa sổ browser, thấy được UI | Debug local, xem scraper hoạt động |

**Headless là gì?**
- **Headless**: Browser chạy không có giao diện đồ họa (GUI), chỉ xử lý logic bên trong.
- **Ưu điểm**: 
  - Tiết kiệm RAM (~200-300MB)
  - Tiết kiệm CPU (không render UI)
  - Phù hợp chạy trên server không có màn hình
- **Nhược điểm**: 
  - Khó debug (không thấy được trang web đang làm gì)
  - Một số website detect headless mode và block

**Code minh họa:**
```go
// Production - Headless (tiết kiệm tài nguyên)
browser, _ := chromium.Launch(playwright.BrowserTypeLaunchOptions{
    Headless: playwright.Bool(true),
})

// Debug - Headful (thấy browser hoạt động)
browser, _ := chromium.Launch(playwright.BrowserTypeLaunchOptions{
    Headless: playwright.Bool(false),
})

// Default - Để Playwright tự quyết định
browser, _ := chromium.Launch(playwright.BrowserTypeLaunchOptions{})
```

---

## 🧪 **TESTING: SHORT MODE**

### ❓ **TODO 21: `testing.Short()` là gì? Tại sao skip test?**

**Trả lời:**

**Short mode** là flag `-short` khi chạy `go test`:
```bash
go test -short  # Chạy ở short mode (nhanh)
go test         # Chạy đầy đủ (chậm)
```

**Mục đích:**
- Skip các test **chậm** (integration test, test cần network, test scraping thật...).
- Chỉ chạy các test **nhanh** (unit test, mock test).

**Code pattern:**
```go
func TestRealScraping(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping integration test in short mode")
    }
    // Test thật với network, mất 10-30s
    // ...
}

func TestUnitLogic(t *testing.T) {
    // Test nhanh, không skip
    // Chạy cả khi -short
}
```

**Use case:**
- **CI/CD**: Chạy `go test -short` để kiểm tra nhanh trước khi merge PR (1-2s).
- **Pre-commit**: Chạy `go test -short` để verify logic cơ bản.
- **Full test**: Chạy `go test` đầy đủ trước khi release (30s-1 phút).

**Best Practice:**
- Test cần network/database/external service → Dùng `testing.Short()` để skip.
- Test logic thuần túy (pure function) → Không cần skip.

---

## 🎯 **JOB FILTERING & SCORING**

### ❓ **TODO 22: Why Normalize Score in CalculateMatchScore()?**

**Context:** `internal/filter/matcher.go:49-56`

**Question:**
Tại sao cần normalize score (clamp to [0, 10]) mặc dù đã biết chắc chắn không thể vượt qua 10?

**Answer:**
Đây là **defensive programming** practice với 3 lý do:

1. **Future-proofing**: Nếu sau này thêm scoring rules mới, có thể quên update max score. Normalization đảm bảo score luôn trong range [0, 10].

2. **Penalty có thể làm score âm**: 
   - Max positive: 3 (golang) + 3 (junior) + 2 (location) + 1 (tech) = 9
   - Penalty: -5
   - Worst case: 0 + 0 + 0 + 0 - 5 = **-5** ❌
   - Normalization: `max(0, -5) = 0` ✅

3. **API Contract**: Function signature `int` không giới hạn range. Normalization làm rõ: "Always returns 0-10".

**Example:**
```go
job := scraper.Job{
    Title: "Golang Developer with 5 years",  // Has penalty
    // No junior, no location, no tech
}
// Without normalization: 3 - 5 = -2 ❌
// With normalization: max(0, -2) = 0 ✅
```

---

### ❓ **TODO 23: Date Regex Patterns Explanation**

**Context:** `internal/filter/date.go:12-14`

**Question:**
Giải thích 2 regex patterns: `isoDateRegex` và `yearOnlyRegex`

**Answer:**

#### **Regex 1: `^\d{4}-\d{2}-\d{2}`**
Matches ISO 8601 date format start.

**Breakdown:**
- `^` - Start of string anchor
- `\d{4}` - Exactly 4 digits (year: 2026)
- `-` - Literal hyphen
- `\d{2}` - Exactly 2 digits (month: 01)
- `-` - Literal hyphen
- `\d{2}` - Exactly 2 digits (day: 27)

**Examples:**
- ✅ `"2026-01-27"` → Match
- ✅ `"2026-01-27T10:30:00"` → Match (ISO with time)
- ❌ `"27/01/2026"` → No match

**Why check full date?**
To ensure valid ISO format before extracting first 10 chars: `dateStr[:10]` → `"2026-01-27"`

#### **Regex 2: `\b(20\d{2})\b`**
Matches years 2000-2099 with word boundaries.

**Breakdown:**
- `\b` - Word boundary (prevents matching inside larger numbers)
- `(20\d{2})` - Capture group: "20" + 2 digits
- `\b` - Word boundary end

**Examples:**
- ✅ `"Posted in 2026"` → Captures `"2026"`
- ❌ `"20260127"` → No match (no word boundary)
- ❌ `"1999"` → No match (doesn't start with "20")

**Why capture group `(...)`?**
`FindStringSubmatch()` returns `[full_match, group1, ...]`, so `match[1]` is the year.

---

### ❓ **TODO 24: ISO 8601 Format with 'T' Separator**

**Context:** `internal/filter/date.go:25`

**Question:**
Cái format `2026-01-27T` có nghĩa là gì?

**Answer:**

**ISO 8601** - International standard for date/time format.

**Full format:**
```
YYYY-MM-DDTHH:MM:SS.sssZ
```

**Breakdown:**
- `YYYY-MM-DD` - Date (year-month-day)
- `T` - **Time separator** (literal character "T")
- `HH:MM:SS` - Time (hour:minute:second)
- `.sss` - Milliseconds (optional)
- `Z` - UTC timezone (or `+07:00` for GMT+7)

**Examples:**
```
2026-01-27T10:30:00Z        → 10:30 AM UTC
2026-01-27T17:30:00+07:00   → 5:30 PM Vietnam time
2026-01-27                  → Date only
```

**Why check both formats?**
Some job boards return full ISO timestamp. Code extracts date part:
```go
"2026-01-27T10:30:00"[:10] → "2026-01-27"
```

**Go's time.Parse format `"2006-01-02"`:**
Go uses **reference time**: `Mon Jan 2 15:04:05 MST 2006`
- `2006` = year, `01` = month, `02` = day
- This is Go's way to define date format (unlike Python's `%Y-%m-%d`)