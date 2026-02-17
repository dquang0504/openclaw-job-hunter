package topcv

import (
	"context"
	"fmt"
	"go-openclaw-automation/internal/config"
	"go-openclaw-automation/internal/scraper"
	"go-openclaw-automation/utils"
	"log"
	"math/rand"
	"strings"
	"time"
	"unicode"

	"github.com/playwright-community/playwright-go"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

type TopCVScraper struct {
	cfg *config.Config
}

func NewTopCVScraper(cfg *config.Config) *TopCVScraper {
	return &TopCVScraper{
		cfg: cfg,
	}
}

func (s *TopCVScraper) Name() string {
	return "TopCV"
}

func normalizeText(str string) string {
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	result, _, _ := transform.String(t, str)
	return strings.ToLower(result)
}

func (s *TopCVScraper) Scrape(ctx context.Context, page playwright.Page) ([]scraper.Job, error) {
	var allJobs []scraper.Job
	log.Println("📋 Searching TopCV.vn...")

	//initialize screenshot debugger
	screenshotDebugger := utils.NewScreenShotDebugger()

	//warmup phase
	log.Println("🏠 Navigating to TopCV Home for warm-up...")
	if _, err := page.Goto("https://www.topcv.vn/", playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(30000),
	}); err != nil {
		//random check for block
		title, _ := page.Title()
		if strings.Contains(title, "Cloudflare") || strings.Contains(title, "Attention Required") {
			log.Println("❌ Cloudflare blocked on Homepage. Skipping...")
			screenshotDebugger.CaptureAndLog(page, "topcv-cloudflare-home", "🚨 TopCV: Blocked by Cloudflare on Homepage")
			return nil, nil
		}

		//simulate reading/interacting
		warmUpDuration := time.Duration(rand.Intn(5000)+5000) * time.Millisecond
		log.Printf("⏳ Warming up for %v...", warmUpDuration)
		time.Sleep(warmUpDuration)
	}

	//define exp levels. 1: No exp, 2: <1 year, 3: 1 year
	expLevels := []int{1, 2, 3}

	//loop through keywords from config
	for _, keyword := range s.cfg.Keywords {
		for _, exp := range expLevels {
			//slugify keyword: "golang developer" -> "golang-developer"

			slug := strings.ReplaceAll(strings.ToLower(keyword), " ", "-")

			//construct URL
			url := fmt.Sprintf("https://www.topcv.vn/tim-viec-lam-%s-tai-ho-chi-minh-kl2?exp=%d&sort=new&type_keyword=1&sba=1&locations=l2_l20&saturday_status=0", slug, exp)
			log.Printf("  🔍 Searching: %s (Exp: %d) - Cần Thơ & HCM", keyword, exp)

			//stealth headers
			page.SetExtraHTTPHeaders(map[string]string{})
			page.SetExtraHTTPHeaders(map[string]string{
				"Referer": "https://www.topcv.vn/",
			})

			//navigate
			if _, err := page.Goto(url, playwright.PageGotoOptions{
				WaitUntil: playwright.WaitUntilStateDomcontentloaded,
				Timeout:   playwright.Float(30000),
			}); err != nil {
				log.Printf("⚠️ Error navigating to %s: %v", url, err)
				continue
			}

			//Cloudflare check
			title, _ := page.Title()
			if strings.Contains(title, "Attention Required") || strings.Contains(title, "Just a moment") || strings.Contains(title, "Cloudflare") {
				log.Println("    🛡️ Cloudflare challenge detected. Waiting 7s...")
				screenshotDebugger.CaptureAndLog(page, "topcv-cloudflare-challenge", "🚨 TopCV: Cloudflare Challenge Detected")
				time.Sleep(7 * time.Second)
				log.Printf("    Checking title again: %s", title)
				if title, _ := page.Title(); strings.Contains(title, "Attention") || strings.Contains(title, "Attention Required") || strings.Contains(title, "Just a moment") || strings.Contains(title, "Cloudflare") {
					log.Println("❌ Cloudflare challenge failed. Skipping...")
					screenshotDebugger.CaptureAndLog(page, "topcv-cloudflare-challenge", "🚨 TopCV: Cloudflare Challenge Detected")
					continue
				}
			}

			//Captcha Check
			captchaCount, _ := page.Locator(".captcha, .recaptcha, [data-captcha]").Count()
			if captchaCount > 0 {
				log.Println("⚠️ CAPTCHA detected. Skipping this search...")
				screenshotDebugger.CaptureAndLog(page, "topcv-captcha-detected", "🚨 TopCV: CAPTCHA Detected")
				continue
			}

			//human behavior
			utils.RandomDelay(1000, 2000)
			utils.MouseJiggle(page)
			utils.SmoothScroll(page)
			utils.RandomDelay(500,1000)

			//check no suitable jobs to fail fast
			if visible, _ := page.Locator(".none-suitable-job").IsVisible(); visible {
				continue
			}

			//get job cards
			jobCards, err := page.Locator(".job-item-search-result").All()
			if len(jobCards) == 0 {
				//fallback
				jobCards, _ = page.Locator(".job-item").All()
			}
			if len(jobCards) == 0 {
				continue
			}
			if err != nil {
				log.Printf("    ⚠️ Error finding job cards: %v", err)
				continue
			}
			log.Printf("    📦 Found %d job cards for '%s'", len(jobCards), keyword)

			//handle popups/modals
			time.Sleep(10 * time.Second)
			surveyModal := page.Locator("#modal-survey-reliability")
			if visible, _ := surveyModal.IsVisible(); visible {
				log.Println("      ⚠️ Survey modal detected. Closing...")
				page.Locator("#modal-survey-reliability .btn-cancel").Click()
				surveyModal.WaitFor(playwright.LocatorWaitForOptions{
					State:   playwright.WaitForSelectorStateHidden,
					Timeout: playwright.Float(2000),
				})
			}

			count := 0
			//loop and extract data
			for _, card := range jobCards {
				//limit to 20
				if count >= 20 {
					break
				}

				if rand.Float32() > 0.8 {
					utils.RandomDelay(100, 300)
				}

				titleEl := card.Locator("h3.title a, .title-block a, a.title").First()
				title, _ := titleEl.TextContent()
				urlVal, _ := titleEl.GetAttribute("href")

				companyEl := card.Locator(".company-name, a.company").First()
				company, _ := companyEl.TextContent()

				salaryEl := card.Locator(".title-salary, .salary").First()
				salary, err := salaryEl.TextContent(playwright.LocatorTextContentOptions{
					Timeout: playwright.Float(100),
				})
				if err != nil {
					salary = "Negotiable"
				}

				locationEl := card.Locator(".address, .location, .label-address").First()
				location, _ := locationEl.TextContent()

				//clean data
				title = strings.TrimSpace(title)
				company = strings.TrimSpace(company)
				location = strings.TrimSpace(location)
				salary = strings.TrimSpace(salary)

				if title == "" {
					continue
				}

				//normalize text and filtering
				fullText := normalizeText(title + " " + company)
				if !strings.Contains(fullText, "go") && !strings.Contains(fullText, "golang") {
					continue
				}

				//exclude keywords
				isExcluded := false
				for _, excluded := range s.cfg.ExcludeKeywords {
					if excluded == "" {
						continue
					}
					if strings.Contains(fullText, strings.ToLower(excluded)) {
						isExcluded = true
						log.Printf("🚫 Skipped excluded keyword '%s': %s", excluded, title)
						break
					}
				}

				if isExcluded {
					continue
				}

				job := scraper.Job{
					Title:       title,
					Company:     company,
					Salary:      salary,
					Location:    location,
					URL:         urlVal,
					Source:      "TopCV",
					PostedDate:  "Recent",
					Description: "None",
					Techstack:   "Golang",
				}

				allJobs = append(allJobs, job)
				log.Printf("      ✅ %s - %s", job.Title, job.Company)
				count++
			}
		}
	}

	//remove duplicates
	uniqueJobs := make([]scraper.Job, 0)
	seenURLs := make(map[string]bool)
	for _, job := range allJobs {
		if !seenURLs[job.URL] {
			seenURLs[job.URL] = true
			uniqueJobs = append(uniqueJobs, job)
		}
	}

	return uniqueJobs, nil
}
