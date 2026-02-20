package linkedin

import (
	"context"
	"fmt"
	"go-openclaw-automation/internal/browser"
	"go-openclaw-automation/internal/config"
	"go-openclaw-automation/internal/filter"
	"go-openclaw-automation/internal/scraper"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
)

type LinkedInScraper struct {
	cfg *config.Config
}

func NewLinkedInScraper(cfg *config.Config) *LinkedInScraper {
	return &LinkedInScraper{cfg: cfg}
}

func (s *LinkedInScraper) Name() string {
	return "LinkedIn"
}

func (s *LinkedInScraper) Scrape(ctx context.Context, page playwright.Page) ([]scraper.Job, error) {
	var jobs []scraper.Job
	log.Println("💼 Searching LinkedIn Jobs (Authenticated)...")

	//warm up phase & login
	log.Println("🏠 Navigating to LinkedIn Feed for warm-up...")
	if _, err := page.Goto("https://www.linkedin.com/feed/", playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(30000),
	}); err != nil {
		return nil, fmt.Errorf("failed to load linkedin feed: %w", err)
	}

	//Verify login
	if _, err := page.WaitForSelector("#global-nav", playwright.PageWaitForSelectorOptions{
		Timeout: playwright.Float(10000),
	}); err != nil {
		return nil, fmt.Errorf("login verification failed - global nav not found")
	}
	log.Println("✅ Login confirmed.")

	//random warm up
	browser.RandomDelay(2000, 4000)
	browser.MouseJiggle(page)

	//define keywords for scraping
	keywords := []string{"fresher golang", "entry level golang", "intern golang"}
	for _, keyword := range keywords {
		log.Printf("\n🔑 Processing Keyword: %q", keyword)
		encodedKeyword := url.QueryEscape(keyword)
		jobSearchURL := fmt.Sprintf("https://www.linkedin.com/jobs/search/?currentJobId=4329358250&f_E=1%%2C2%%2C3&f_TPR=r2592000&f_WT=1%%2C3&geoId=104195383&keywords=%s&origin=JOB_SEARCH_PAGE_JOB_FILTER&refresh=true", encodedKeyword)

		log.Printf("  🌐 Visiting Job Search: %s", jobSearchURL)
		if _, err := page.Goto(jobSearchURL, playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(30000),
		}); err != nil {
			log.Printf("    ⚠️ Failed to load job search page: %v", err)
			continue
		}

		//wait for job list
		_, err := page.WaitForSelector("li.scaffold-layout__list-item, .job-card-container", playwright.PageWaitForSelectorOptions{
			Timeout: playwright.Float(15000),
		})
		if err != nil {
			log.Println("    ⚠️ Job list not found or empty.")
			continue
		}
		browser.RandomDelay(2000, 3000)
		browser.HumanScroll(page)

		//Get job items
		jobItems, err := page.Locator("li.scaffold-layout__list-item, li.jobs-search-results__list-item").All()
		if err != nil {
			log.Printf("Error finding job items: %v", err)
			continue
		}
		log.Printf("    📄 Found %d potential jobs.", len(jobItems))

		//limit scan
		maxScan := 10
		if len(jobItems) < maxScan {
			maxScan = len(jobItems)
		}
		var jobUrls []string
		for i := 0; i < maxScan; i++ {
			linkEl := jobItems[i].Locator("a.job-card-container__link").First()
			href, err := linkEl.GetAttribute("href")
			if err == nil && href != "" {
				fullUrl := href
				if !strings.HasPrefix(href, "http") {
					fullUrl = "https://www.linkedin.com" + href
				}
				// Normalizing URL by removing query parameters
				// LinkedIn URLs often contain dynamic tracking params (?refId=..., ?trackingId=...)
				// which make the same job appear as different URLs.
				// Removing them ensures we get the canonical URL for deduplication.
				parts := strings.Split(fullUrl, "?")
				jobUrls = append(jobUrls, parts[0])
			}
		}
		log.Printf("    🔗 Extracted %d links. Processing...", len(jobUrls))

		//process in batches
		newJobsFound := 0
		batchSize := 5
		for i := 0; i < len(jobUrls); i += batchSize {
			if newJobsFound >= 5 {
				//limit valid jobs per keyword
				break
			}
			end := i + batchSize
			if end > len(jobUrls) {
				end = len(jobUrls)
			}
			batchUrls := jobUrls[i:end]

			for _, url := range batchUrls {
				jobPage, err := page.Context().NewPage()
				if err != nil {
					log.Printf("Failed to create new page: %v", err)
					continue
				}

				//process job detail
				job, err := s.processJobDetail(jobPage, url)
				jobPage.Close() //always close tab
				if err != nil {
					log.Printf("      ⚠️ Job Processing Error: %v", err)
					continue
				}

				if job != nil {
					jobs = append(jobs, *job)
					newJobsFound++
				}
			}
		}

		//post search

	}
	return jobs, nil
}

func (s *LinkedInScraper) processJobDetail(page playwright.Page, url string) (*scraper.Job, error) {
	if _, err := page.Goto(url, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(30000),
	}); err != nil {
		return nil, err
	}

	//wait for content and fail fast
	_, err := page.WaitForSelector(".job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__job-title", playwright.PageWaitForSelectorOptions{
		Timeout: playwright.Float(5000),
	})
	if err != nil {
		return nil, fmt.Errorf("job details not found")
	}

	//extract title & company
	title, _ := page.Locator(".job-details-jobs-unified-top-card__job-title, h1").First().InnerText()
	company, _ := page.Locator(".job-details-jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__subtitle").First().InnerText()

	//extract location & date
	location := "Unknown location"
	postedDate := "Past month"

	primaryDescEl := page.Locator(".job-details-jobs-unified-top-card__primary-description-container").First()
	if count, _ := primaryDescEl.Count(); count > 0 {
		descText, _ := primaryDescEl.InnerText()
		parts := strings.Split(descText, "·")
		if len(parts) > 0 {
			location = strings.TrimSpace(parts[0])
		}
		//date parsing regex could be added here
	} else {
		locEl := page.Locator(".job-details-jobs-unified-top-card__bullet, .job-details-jobs-unified-top-card__workplace-type").First()
		if txt, err := locEl.InnerText(); err == nil {
			location = txt
		}
	}

	//expand description
	showMoreBtn := page.Locator("button[data-testid=\"expandable-text-button\"]")
	if isVisible, _ := showMoreBtn.IsVisible(); isVisible {
		showMoreBtn.Click(playwright.LocatorClickOptions{
			Force: playwright.Bool(true),
		})
		time.Sleep(500 * time.Millisecond)
	}

	//get description
	description := ""
	descEl := page.Locator("[data-testid=\"expandable-text-box\"]").First()
	if count, _ := descEl.Count(); count > 0 {
		description, _ = descEl.InnerText()
	} else {
		fallbackEl := page.Locator("#job-details, .jobs-description__content").First()
		if count, _ := fallbackEl.Count(); count > 0 {
			description, _ = fallbackEl.InnerText()
		}
	}

	cleanTitle := strings.TrimSpace(title)
	cleanLocation := strings.TrimSpace(location)

	//apply filters
	fullText := strings.ToLower(cleanTitle + " " + description + " " + cleanLocation)

	//Hanoi filter
	hanoiRegex := []string{"hn", "hanoi", "ha noi", "thu do", "ha noi city"}
	for _, h := range hanoiRegex {
		if strings.Contains(fullText, h) {
			log.Println("      ❌ [Target Failed] Location Hanoi")
			return nil, nil
		}
	}

	//normalize location
	finalLocation := cleanLocation
	if strings.Contains(fullText, "hcm") || strings.Contains(fullText, "ho chi minh") || strings.Contains(fullText, "saigon") {
		finalLocation = "HCM"
	} else if strings.Contains(fullText, "can tho") {
		finalLocation = "Can Tho"
	} else if strings.Contains(fullText, "remote") {
		finalLocation = "Remote"
	}

	job := scraper.Job{
		Title:       cleanTitle,
		Company:     strings.TrimSpace(company),
		URL:         url,
		Description: description,
		Location:    finalLocation,
		Source:      "LinkedIn",
		Techstack:   "Golang",
		PostedDate:  postedDate,
		MatchScore:  0,
	}

	//cacl score using shared filter logic
	job.MatchScore = filter.CalculateMatchScore(job)
	if job.MatchScore >= 5 {
		log.Printf("      ✅ Valid Job! %dpts - %s - %s", job.MatchScore, finalLocation, postedDate)
		return &job, nil
	}

	log.Printf("      ⚠️ Low Score (%d): %s", job.MatchScore, cleanTitle)
	return nil, nil
}
