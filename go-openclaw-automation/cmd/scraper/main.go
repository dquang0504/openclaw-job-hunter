package main

import (
	"context"
	"fmt"
	"go-openclaw-automation/internal/browser"
	"go-openclaw-automation/internal/config"
	"go-openclaw-automation/internal/database"
	"go-openclaw-automation/internal/filter"
	"go-openclaw-automation/internal/models"
	"go-openclaw-automation/internal/scraper"
	"go-openclaw-automation/internal/scraper/itviec"
	"go-openclaw-automation/internal/scraper/topcv"
	"go-openclaw-automation/internal/scraper/twitter"
	"go-openclaw-automation/internal/telegram"
	"log"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/playwright-community/playwright-go"
	"golang.org/x/sync/errgroup"
)

func main() {
	//load config
	cfg := config.Load()
	log.Printf("🔧 Config loaded. Keywords: %v", cfg.Keywords)

	//db init
	repo, err := database.ConnectDB(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Printf("⚠️ DB not connected, jobs won't be saved: %v", err)
	} else {
		defer repo.Close()
		log.Println("✅ Database Connected")
	}

	//init telegram bot
	bot, err := telegram.NewBot(cfg.TelegramToken, cfg.TelegramChatID)
	if err != nil {
		log.Fatalf("❌ Failed to init Telegram Bot: %v", err)
	}
	log.Println("🤖 Telegram Bot initialized.")

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
		"topcv":    filepath.Join(cfg.CookiesPath, "cookies-topcv.json"),
		"itviec":   filepath.Join(cfg.CookiesPath, "cookies-itviec.json"),
		"linkedin": filepath.Join(cfg.CookiesPath, "cookies-linkedin.json"),
		"twitter":  filepath.Join(cfg.CookiesPath, "cookies-twitter.json"),
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

	log.Println("✅ Browser initialized successfully!")

	//initialize scrapers
	scrapers := []scraper.Scraper{
		topcv.NewTopCVScraper(cfg),
		itviec.NewITViecScraper(cfg),
		// linkedin.NewLinkedInScraper(cfg),
		twitter.NewTwitterScraper(cfg),
	}

	//run scrapers loop
	var allJobs []scraper.Job
	var mu sync.Mutex
	g, gCtx := errgroup.WithContext(ctx)
	for _, s := range scrapers {
		g.Go(func() error {
			log.Printf("\n▶️ Starting scraper: %s", s.Name())
			jobs, err := s.Scrape(gCtx, browserCtx)
			if err != nil {
				log.Printf("❌ Error running scraper %s: %v", s.Name(), err)
				return nil
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

			mu.Lock()
			allJobs = append(allJobs, filteredJobs...)
			mu.Unlock()
			return nil
		})
	}

	//wait for all scrapers to finish
	if err := g.Wait(); err != nil {
		log.Printf("⚠️ Some scraper errors: %v", err)
	}

	log.Printf("\n📦 Total jobs collected: %d", len(allJobs))

	// Dedup using DB as the single source of truth.
	// When repo is nil (no DB), treat ALL jobs as unseen (send everything).
	var unseenJobs []scraper.Job
	for _, job := range allJobs {
		if repo == nil || !repo.IsJobSeen(ctx, job.URL) {
			unseenJobs = append(unseenJobs, job)
		}
	}
	log.Printf("🔍 Deduplication (DB): %d total → %d unseen jobs", len(allJobs), len(unseenJobs))

	//start saving to DB and sending to telegram
	if len(unseenJobs) > 0 {
		type savedResult struct {
			job   scraper.Job
			jobID string // empty if repo is nil or save failed
		}
		savedResults := make([]savedResult, len(unseenJobs))
		var dbWg sync.WaitGroup
		log.Printf("📊 Found %d valid NEW jobs — saving to DB in parallel...", len(unseenJobs))

		// ── Phase 1: Save ALL jobs to DB concurrently ────────────────────────
		for i, job := range unseenJobs {
			dbWg.Add(1)
			go func(idx int, j scraper.Job) {
				defer dbWg.Done()
				savedResults[idx] = savedResult{job: j} // default: empty jobID

				if repo == nil {
					return
				}
				dbJob := &models.Job{
					Source:         j.Source,
					ExternalID:     extractExternalID(j.URL),
					Title:          j.Title,
					Company:        j.Company,
					URL:            j.URL,
					Location:       j.Location,
					Salary:         j.Salary,
					DescriptionRaw: j.Description,
					MatchScore:     j.MatchScore,
					PostedAt:       j.PostedDate,
				}
				saved, err := repo.SaveJob(ctx, dbJob)
				if err != nil {
					log.Printf("⚠️ Failed to save job to DB: %v", err)
					return
				}
				savedResults[idx].jobID = saved.ID
				log.Printf("💾 Job saved to DB with ID: %s", saved.ID)
			}(i, job)
		}

		// Wait for ALL DB saves to finish before sending any Telegram message
		dbWg.Wait()
		log.Printf("💾 All DB saves complete — sending to Telegram...")

		// ── Phase 2: Send Telegram sequentially (rate limited) ───────────────
		for _, result := range savedResults {
			log.Printf("  [%d/10] %s @ %s", result.job.MatchScore, result.job.Title, result.job.Company)
			if err := bot.SendJob(result.job, result.jobID); err != nil {
				log.Printf("⚠️ Failed to send job to Telegram: %v", err)
			}
			time.Sleep(1 * time.Second) // rate limit: avoid Telegram 429
		}

		// Send summary status
		statusMsg := fmt.Sprintf("✅ Found %d new valid jobs, sent %d jobs.", len(unseenJobs), len(unseenJobs))
		if err := bot.SendStatus(statusMsg); err != nil {
			log.Printf("⚠️ Failed to send status to Telegram: %v", err)
		}
	}

	log.Println("🏁 Execution finished.")
}
