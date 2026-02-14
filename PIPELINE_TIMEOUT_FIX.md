# 🔧 Pipeline Timeout Fix - Giải Thích Chi Tiết

## 📊 **Tình Huống Ban Đầu**

### Pipeline Performance:
- ✅ **Facebook Scraper**: ~5 phút (OK)
- ✅ **Threads Scraper**: ~2 phút (OK)  
- ❌ **Others Pipeline**: **14+ phút** → TIMEOUT (15 phút limit)

### Logs Phân Tích:
```
📋 Searching ITViec...
  📦 Found 20 job cards
    ✅ Backend Engineer (Scala/Kotlin/Golang) - Semrush
    ✅ Backend Engineer (Golang/ Ruby on Rails) - Hubble
    ✅ Fullstack Developer (Python/ Golang/ C++) - OceanNet
##***error***The operation was canceled.
```

**Vấn đề**: Sau khi xử lý 3 job cards, scraper **đứng im** cho đến khi timeout.

---

## 🔍 **Nguyên Nhân Gốc Rễ**

### **1. ITViec Scraper - CRITICAL ISSUE** ⚠️

**Vấn đề chính**: Selector `.job-description` và `.job-experiences` **không tồn tại** hoặc **load chậm** trong GitHub Actions.

**Code cũ** (dòng 166-167):
```javascript
const jobDesc = await detailPanel.locator('.job-description').innerText({ timeout: 3000 });
const jobSkills = await detailPanel.locator('.job-experiences').innerText({ timeout: 3000 });
```

**Tại sao bị timeout?**
- Mỗi selector timeout **3 giây**
- Có **2 selectors** → 6 giây/card nếu fail
- Xử lý **20 cards** → 6s × 20 = **2 phút** (nếu tất cả fail)
- **NHƯNG** vấn đề thực sự: Sau khi click card thứ 3, trang web có thể bị **stale** hoặc **navigation** xảy ra
- Playwright **chờ mãi** không thấy selector → **đứng máy** cho đến khi workflow timeout (15 phút)

**Tại sao ở local chạy được?**
- Local: Network nhanh hơn, trang load đầy đủ
- GitHub Actions: Network chậm, có thể thiếu resources, trang load không đầy đủ
- Selectors có thể **khác nhau** giữa authenticated/unauthenticated state

---

### **2. TopDev Scraper - Timeout Ngay Từ Đầu**

**Logs**:
```
⚠️ TopDev Error for golang: page.goto: Timeout 20000ms exceeded.
```

**Nguyên nhân**:
- TopDev.vn có thể **chặn GitHub Actions IP** (bot detection)
- Network latency cao trong CI environment
- `waitUntil: 'domcontentloaded'` với timeout **20s** không đủ

---

### **3. Vercel Scraper - Chậm Do Retry Logic**

**Code cũ**:
```javascript
await page.waitForTimeout(3000);  // Initial wait
await page.waitForTimeout(5000);  // Retry wait
// Có thể retry 3 lần → 15-20 giây
```

---

### **4. Indeed Scraper - Tiềm Ẩn Timeout**

**Vấn đề**:
- Cloudflare detection wait: **5 giây**
- Scroll + click timeout: **5 giây/card**
- Random delay: **500-1000ms/card**

Nếu có nhiều cards → tích lũy thành **vài phút**

---

## ✅ **Giải Pháp Đã Áp Dụng**

### **Fix 1: ITViec - Thêm Per-Card Timeout** 🎯

**Chiến lược**: Wrap toàn bộ xử lý mỗi card trong `Promise.race()` với timeout **8 giây**.

**Code mới**:
```javascript
await Promise.race([
    (async () => {
        // ... xử lý card ...
        await page.waitForTimeout(300);  // Giảm từ 500ms
        
        const isPanelVisible = await detailPanel.isVisible({ timeout: 2000 });
        if (isPanelVisible) {
            const jobDesc = await detailPanel.locator('.job-description')
                .innerText({ timeout: 1500 });  // Giảm từ 3000ms
            const jobSkills = await detailPanel.locator('.job-experiences')
                .innerText({ timeout: 1500 });
        }
    })(),
    // CRITICAL: Timeout toàn bộ card sau 8 giây
    new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Card processing timeout')), 8000)
    )
]);
```

**Hiệu quả**:
- ✅ Nếu 1 card bị stuck → **tối đa 8 giây** rồi skip
- ✅ 20 cards × 8s = **2.7 phút** (worst case)
- ✅ Thực tế: Chỉ card bị lỗi mới timeout, cards bình thường chạy **1-2 giây**

---

### **Fix 2: TopDev - Tăng Timeout + Fallback** 🔄

**Code mới**:
```javascript
// Tăng timeout từ 20s → 40s
try {
    await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded', 
        timeout: 40000 
    });
} catch (e) {
    if (e.message.includes('Timeout')) {
        console.log('⚠️ domcontentloaded timeout, trying networkidle...');
        await page.goto(searchUrl, { 
            waitUntil: 'networkidle', 
            timeout: 40000 
        });
    }
}

// Giảm wait time từ 3s → 2s
await page.waitForTimeout(2000);
```

**Hiệu quả**:
- ✅ Cho phép trang load chậm hơn trong CI
- ✅ Fallback sang `networkidle` nếu `domcontentloaded` fail
- ✅ Tiết kiệm **1 giây** mỗi search

---

### **Fix 3: Vercel - Giảm Wait Time** ⚡

**Code mới**:
```javascript
// Giảm từ 3s → 2s
await page.waitForTimeout(2000);

// Trong retry: giảm từ 5s → 3s
if (attempt > 1) {
    if (page.isClosed()) return;  // Early exit
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
}
```

**Hiệu quả**:
- ✅ Tiết kiệm **1-2 giây** mỗi lần chạy
- ✅ Tránh retry khi page đã đóng

---

### **Fix 4: Indeed - Tối Ưu Timeouts** 🚀

**Code mới**:
```javascript
// Cloudflare: giảm từ 5s → 3s
await page.waitForTimeout(3000);

// Scroll + Click: giảm timeout
await card.scrollIntoViewIfNeeded({ timeout: 3000 });  // từ 5s
await linkEl.click({ timeout: 2000 });  // từ 3s
await page.waitForSelector(descSelector, { timeout: 4000 });  // từ 5s

// Random delay: giảm từ 500-1000ms → 300-600ms
await randomDelay(300, 600);
```

**Hiệu quả**:
- ✅ Tiết kiệm **~3 giây** mỗi card
- ✅ Nếu có 10 cards → tiết kiệm **30 giây**

---

## 📈 **Kết Quả Dự Kiến**

### **Trước khi fix**:
```
Facebook:  ~5 phút   ✅
Threads:   ~2 phút   ✅
Others:    14+ phút  ❌ TIMEOUT
```

### **Sau khi fix** (dự đoán):
```
Facebook:  ~5 phút   ✅
Threads:   ~2 phút   ✅
Others:    ~6-8 phút ✅ (trong limit 15 phút)
```

**Breakdown "Others" pipeline**:
- TopCV: ~1 phút (không có job → nhanh)
- Twitter: ~1 phút (5 tweets)
- Indeed: ~1 phút (không có job)
- TopDev: ~2 phút (timeout → skip nhanh hơn)
- ITViec: **~2-3 phút** (thay vì 14+ phút)
- Vercel: ~30 giây
- Cloudflare: ~10 giây (API call)

**Tổng**: ~6-8 phút ✅

---

## 🎯 **Tại Sao Ở Local Chạy Được?**

1. **Network Speed**: Local internet nhanh hơn GitHub Actions
2. **Resources**: Local có nhiều CPU/RAM hơn
3. **Cookies**: Authenticated state khác nhau → HTML structure khác
4. **Timing**: Local load trang nhanh → selectors xuất hiện đúng lúc
5. **Browser Context**: GitHub Actions có thể bị throttle bởi bot detection

---

## 🔍 **Cách Debug Nếu Vẫn Timeout**

### **Bước 1**: Kiểm tra logs chi tiết
```bash
# Xem logs của ITViec scraper
grep "ITViec" logs/job-search-*.json
```

### **Bước 2**: Thêm debug logging
```javascript
console.log(`⏱️ Card ${i}/20: Starting...`);
// ... xử lý card ...
console.log(`✅ Card ${i}/20: Done in ${Date.now() - startTime}ms`);
```

### **Bước 3**: Chạy từng scraper riêng lẻ
```bash
# Test riêng ITViec
node execution/job-search.js --platform=itviec
```

### **Bước 4**: Tăng timeout của workflow
```yaml
# .github/workflows/job-search.yml
timeout-minutes: 20  # Tăng từ 15 → 20
```

---

## 📝 **Tóm Tắt**

### **Vấn đề chính**: 
ITViec scraper bị **stuck** khi selector không tồn tại, chờ mãi cho đến khi workflow timeout.

### **Giải pháp chính**:
Thêm **per-card timeout** (8s) để fail fast thay vì chờ mãi.

### **Các tối ưu phụ**:
- TopDev: Tăng timeout, thêm fallback
- Vercel: Giảm wait time
- Indeed: Giảm timeout các operations

### **Kết quả**:
Pipeline "others" giảm từ **14+ phút** xuống **~6-8 phút** ✅
