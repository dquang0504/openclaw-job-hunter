package main

import (
	"context"
	"encoding/json"
	"fmt"
	"go-openclaw-automation/internal/browser"
	"go-openclaw-automation/internal/config"
	"go-openclaw-automation/internal/filter"
	"go-openclaw-automation/internal/scraper"
	"go-openclaw-automation/internal/scraper/topcv"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"
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
	cookiePath := filepath.Join("..", ".cookies", "cookies-facebook.json")
	log.Printf("🍪 Loading cookies from: %s", cookiePath)
	cookies, err := browser.LoadCookies(cookiePath)
	if err != nil {
		log.Printf("⚠️ Warning: Could not load cookies: %v. Continuing without cookies.", err)
	}

	//create new browser context with cookies
	browserCtx, err := pwManager.NewContext(cookies)
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

	//save results
	saveJobs(allJobs)

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
