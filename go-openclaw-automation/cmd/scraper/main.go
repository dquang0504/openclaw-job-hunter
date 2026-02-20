package main

import (
	"context"
	"encoding/json"
	"fmt"
	"go-openclaw-automation/internal/browser"
	"go-openclaw-automation/internal/config"
	"go-openclaw-automation/internal/dedup"
	"go-openclaw-automation/internal/filter"
	"go-openclaw-automation/internal/scraper"
	"go-openclaw-automation/internal/scraper/itviec"
	"go-openclaw-automation/internal/scraper/linkedin"
	"go-openclaw-automation/internal/scraper/topcv"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/playwright-community/playwright-go"
)

func main() {
	//load config
	cfg := config.Load()
	log.Printf("🔧 Config loaded. Keywords: %v", cfg.Keywords)

	//setup context with timeout = 10 mins
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	log.Println("🚀 Starting OpenClaw Automation (Go version)...")

	//init playwright manager
	pwManager, err := browser.NewPlaywright(ctx)
	if err != nil {
		log.Fatalf("❌ Failed to init Playwright: %v", err)
	}
	//close playwright manager when application stops
	defer pwManager.Close()

	//load cookies
	cookieFiles := map[string]string{
		"topcv": filepath.Join(cfg.CookiesPath, "cookies-topcv.json"),
		"itviec": filepath.Join(cfg.CookiesPath, "cookies-itviec.json"),
		"linkedin": filepath.Join(cfg.CookiesPath, "cookies-linkedin.json"),
	}
	var allCookies []playwright.OptionalCookie
	for name, cookieFile := range cookieFiles {
		cookies, err := browser.LoadCookies(cookieFile)
		if err != nil {
			log.Printf("⚠️ Could not load %s cookies: %v. Continuing.", name, err)
			continue
		}
		log.Printf("🍪 Loaded %s cookies (%d)", name, len(cookies))
		allCookies = append(allCookies, cookies...)
	}
	
	//create new browser context with cookies
	browserCtx, err := pwManager.NewContext(allCookies)
	if err != nil {
		log.Fatalf("❌ Failed to create browser context: %v", err)
	}

	//create new page
	page, err := browserCtx.NewPage()
	if err != nil {
		log.Fatalf("❌ Failed to create new page: %v", err)
	}
	log.Println("✅ Browser initialized successfully!")

	//initialize scrapers
	scrapers := []scraper.Scraper{
		topcv.NewTopCVScraper(cfg),
		itviec.NewITViecScraper(cfg),
		linkedin.NewLinkedInScraper(cfg),
	}

	//run scrapers loop
	var allJobs []scraper.Job
	for _, s := range scrapers {
		log.Printf("\n▶️ Starting scraper: %s", s.Name())
		jobs, err := s.Scrape(ctx, page)
		if err != nil {
			log.Fatalf("❌ Error running scraper %s: %v", s.Name(), err)
		}

		//Filter jobs
		var filteredJobs []scraper.Job
		for _, job := range jobs {
			if filter.ShouldIncludeJob(job) {
				//calc score
				job.MatchScore = filter.CalculateMatchScore(job)
				filteredJobs = append(filteredJobs, job)
			}
		}

		//sort jobs by score
		sort.Slice(filteredJobs, func(i, j int) bool {
			return filteredJobs[i].MatchScore > filteredJobs[j].MatchScore
		})

		log.Printf("Filtered: %d/%d jobs (sorted by score)", len(filteredJobs), len(jobs))

		log.Printf("✅ Scraper %s finished. Found %d jobs.", s.Name(), len(jobs))
		allJobs = append(allJobs, filteredJobs...)
	}

	log.Printf("\n📦 Total jobs collected: %d", len(allJobs))

	//dedup jobs
	jobCache := dedup.NewJobCache(cfg.CachePath)
	var unseenJobs []scraper.Job
	for _, job := range allJobs {
		if !jobCache.IsSeen(job.URL) {
			unseenJobs = append(unseenJobs, job)
		}
	}
	log.Printf("🔍 Deduplication: %d total -> %d unseen jobs", len(allJobs), len(unseenJobs))
	// Mark all unseen jobs as seen (Telegram will be added later)
	// When Telegram is integrated, only mark jobs that were actually sent
	var unseenURLs []string
	for _, job := range unseenJobs {
		unseenURLs = append(unseenURLs, job.URL)
	}
	jobCache.Add(unseenURLs)
	log.Printf("💾 Marked %d jobs as seen", len(unseenURLs))

	//save results
	saveJobs(unseenJobs)

	log.Println("🏁 Execution finished.")
}

func saveJobs(jobs []scraper.Job) {
	if len(jobs) == 0 {
		log.Println("ℹ️ No jobs to save.")
		return
	}

	//create logs directory if not exists
	logDir := "logs"
	if err := os.MkdirAll(logDir, 0755); err != nil {
		log.Printf("⚠️ Failed to create logs directory: %v", err)
		return
	}

	//gen filename: job-search-YYYY-MM-DD.json
	filename := fmt.Sprintf("job-search-%s.json", time.Now().Format("2006-01-02"))
	filePath := filepath.Join(logDir, filename)

	//marshal
	data, err := json.MarshalIndent(jobs, "", " ")
	if err != nil {
		log.Printf("⚠️ Failed to marshal jobs to JSON: %v", err)
		return
	}

	//write file
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		log.Printf("⚠️ Failed to write logs file: %v", err)
		return
	}

	log.Printf("📁 Results saved to %s", filePath)
}
