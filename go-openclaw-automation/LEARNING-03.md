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

**Code hoàn chỉnh:**
```go
if len(cookies) > 0 {
    // Chỉ cần truyền slice thôi!
    err = ctx.AddCookies(cookies) 
    if err != nil {
        ctx.Close()
        return nil, err
    }
}
```

---

## 🛠️ **SUMMARY: NODE.JS vs GO PLAYWRIGHT**

| Feature | Node.js | Go |
|---------|---------|----|
| **Options** | Object literal: `{ headless: true }` | Struct with Pointers: `{ Headless: playwright.Bool(true) }` |
| **Variadic** | `func(...args)` | `func(args ...Type)` |
| **Async/Await** | `await page.goto()` | Synchronous (nhưng Go routine safe): `page.Goto()` |
| **Selectors** | `page.$('div')` | `page.QuerySelector("div")` |
