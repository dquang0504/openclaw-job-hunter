package itviec

import (
	"context"
	"fmt"
	"go-openclaw-automation/internal/config"
	"go-openclaw-automation/internal/scraper"
	"go-openclaw-automation/utils"
	"log"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
)

type ITViecScraper struct {
	cfg *config.Config
}

func NewITViecScraper(cfg *config.Config) *ITViecScraper {
	return &ITViecScraper{cfg: cfg}
}

func (s *ITViecScraper) Name() string {
	return "ITViec"
}

func (s *ITViecScraper) Scrape(ctx context.Context, page playwright.Page) ([]scraper.Job, error) {
	var jobs []scraper.Job

	//configure locations mapping
	locations := []struct {
		Slug string
		Name string
	}{
		{
			Slug: "ho-chi-minh-hcm",
			Name: "Ho Chi Minh",
		},
		{
			Slug: "can-tho",
			Name: "Can Tho",
		},
	}

	for _, keyword := range s.cfg.Keywords {
		//Slugify keyword: "golang developer" => "golang-developer"
		keywordSlug := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(keyword)), " ", "-")
		for _, loc := range locations {
			//check context cancellation
			if ctx.Err() != nil {
				return jobs, ctx.Err()
			}

			url := fmt.Sprintf("https://itviec.com/it-jobs/%s/%s", keywordSlug, loc.Slug)
			log.Printf("  🔍 Searching: %s - %s (Applying UI Filter)", keyword, loc.Name)

			//navigate
			if _, err := page.Goto(url, playwright.PageGotoOptions{
				WaitUntil: playwright.WaitUntilStateDomcontentloaded,
				Timeout:   playwright.Float(30000),
			}); err != nil {
				log.Printf("    ⚠️ Navigation failed: %v", err)
				continue
			}

			//wait for 15s for filter to load
			log.Println("    ⏳ Waiting 15s before applying filters...")
			time.Sleep(15 * time.Second)

			//antibot check
			if err := s.handleCloudflare(page); err != nil {
				log.Printf("    🚫 Cloudflare blocked: %v", err)
				return jobs, err // Stop scraping if blocked
			}

			//UI filter interaction
			if err := s.applyFresherFilter(page); err != nil {
				log.Printf("    ⚠️ UI Filter Error: %v", err)
				// Continue scraping even if filter fails, but warn
			}

			//Check empty state
			if visible, _ := page.Locator(`div[data-jobs--filter-target="searchNoInfo"]:not(.d-none)`).IsVisible(); visible {
				log.Printf("    ⚠️ No jobs found (Empty State)")
				continue
			}

			//get job cards
			page.WaitForSelector("div.job-card", playwright.PageWaitForSelectorOptions{
				Timeout: playwright.Float(3000),
			})
			cards, err := page.Locator("div.job-card").All()
			if err != nil {
				log.Printf("    ⚠️ Error getting job cards: %v", err)
				continue
			}
			log.Printf("    📦 Found %d job cards", len(cards))

			//process first 15 cards
			limit := 15
			if len(cards) < limit {
				limit = len(cards)
			}

			for i := 0; i < limit; i++ {
				card := cards[i]
				job, err := s.processJobCard(ctx, page, card, keyword)
				if err != nil {
					continue
				}
				jobs = append(jobs, *job)
				log.Printf("      ✅ %s - %s", job.Title, job.Company)
			}
		}
	}

	//dedup by URL
	uniqueJobs := make(map[string]scraper.Job)
	for _, job := range jobs {
		uniqueJobs[job.URL] = job
	}

	result := make([]scraper.Job, 0, len(uniqueJobs))
	for _, job := range uniqueJobs {
		result = append(result, job)
	}

	return result, nil
}

// handleCloudflare checks and attempt to solve turnstile
func (s *ITViecScraper) handleCloudflare(page playwright.Page) error {
	title, _ := page.Title()
	if strings.Contains(title, "Attention Required") || strings.Contains(title, "Just a moment") || strings.Contains(title, "Cloudflare") {
		log.Println("    🛡️ Cloudflare challenge detected on ITViec...")
		time.Sleep(3 * time.Second)
	}

	//Find turnstile frame
	frames := page.Frames()
	var turnstileFrame playwright.Frame
	for _, f := range frames {
		if strings.Contains(f.URL(), "cloudflare") || strings.Contains(f.Name(), "turnstile") {
			turnstileFrame = f
			break
		}
	}

	if turnstileFrame != nil {
		log.Println("    🤖 Found Cloudflare/Turnstile Frame, checking for checkbox...")
		checkbox := turnstileFrame.Locator(`input[type="checkbox"], .ctp-checkbox-label, #challenge-stage`).First()
		if visible, _ := checkbox.IsVisible(); visible {
			utils.MouseJiggle(page)
			checkbox.Click()
			log.Println("    🖱️ Clicked Turnstile checkbox!")
			time.Sleep(5 * time.Second)
		}
	}

	//final check
	newTitle, _ := page.Title()
	if strings.Contains(newTitle, "Attention Required") || strings.Contains(newTitle, "Cloudflare") {
		// Capture screenshot
		utils.NewScreenShotDebugger().CaptureAndLog(page, "itviec-cloudflare-blocked", "🚨 ITViec: Cloudflare Challenge Detected")
		return fmt.Errorf("Cloudflare challenge persist")
	}
	log.Println("    ✅ Cloudflare challenge passed!")
	return nil
}

// applyFresherFilter interacts with the UI to select Fresher level
func (s *ITViecScraper) applyFresherFilter(page playwright.Page) error {
	dropdown := page.Locator("#dropdown-job-level")
	if visible, _ := dropdown.IsVisible(); visible {
		dropdown.Click()
		time.Sleep(1 * time.Second)

		//Select fresher
		fresherInput := page.Locator(`input[value="Fresher"][name="job_level_names[]"]`)
		fresherLabel := page.Locator(`label[for*="Fresher"],label:has-text("Fresher")`)
		clicked := false
		if count, _ := fresherInput.Count(); count > 0 {
			if err := fresherInput.First().Click(playwright.LocatorClickOptions{
				Force: playwright.Bool(true),
			}); err == nil {
				clicked = true
			}
		}
		if !clicked {
			if count, _ := fresherLabel.Count(); count > 0 {
				if err := fresherLabel.First().Click(playwright.LocatorClickOptions{
					Force: playwright.Bool(true),
				}); err == nil {
					clicked = true
				}
			}
		}
		if clicked {
			log.Println("    🔽 UI Filter Applied: Fresher")
			// Wait for network idle (simulated)
			time.Sleep(2 * time.Second)
			//close dropdown
			page.Locator("body").Click(playwright.LocatorClickOptions{
				Force:    playwright.Bool(true),
				Position: &playwright.Position{X: 1, Y: 1},
			})
			//verify
			badge := page.Locator(`[data-jobs--filter-target="filterCounter"]`).First()
			if visible, _ := badge.IsVisible(); visible {
				text, _ := badge.TextContent()
				if strings.TrimSpace(text) == "1" {
					log.Println("    ✅ Filter verification success: 1 active filter confirmed.")
					return nil
				}
			}
			return fmt.Errorf("filter verification failed")
		}
		return fmt.Errorf("failed to click Fresher option")
	}
	log.Println("    ℹ️ Level dropdown not found, skipping filter.")
	return nil
}

func (s *ITViecScraper) processJobCard(ctx context.Context, page playwright.Page, card playwright.Locator, keyword string) (*scraper.Job, error) {
	//Basic info
	titleEl := card.Locator("h3").First()
	title, err := titleEl.TextContent()
	if err != nil {
		return nil, err
	}

	company, _ := card.Locator("a.text-rich-grey, span.text-rich-grey").First().TextContent()
	salary, _ := card.Locator("div.salary span.ips-2").First().TextContent()
	if salary == "" {
		salary = "Negotiable"
	}

	locEl := card.Locator("div.text-rich-grey[title]").Last()
	location, _ := locEl.TextContent()

	//Click for details
	if err := card.ScrollIntoViewIfNeeded(); err != nil {
		return nil, err
	}
	if err := card.Click(playwright.LocatorClickOptions{
		Force: playwright.Bool(true),
	}); err != nil {
		return nil, err
	}

	//short wait
	time.Sleep(300 * time.Millisecond)

	//clean params
	fullURL := page.URL()
	if idx := strings.Index(fullURL, "?"); idx != -1 {
		fullURL = fullURL[:idx]
	}

	//get description
	description := ""
	detailPanel := page.Locator("div.preview-job-content")
	if visible, _ := detailPanel.IsVisible(playwright.LocatorIsVisibleOptions{
		Timeout: playwright.Float(2000),
	}); visible {
		desc, _ := detailPanel.Locator(".job-description").InnerText(playwright.LocatorInnerTextOptions{
			Timeout: playwright.Float(1500),
		})
		skills, _ := detailPanel.Locator(".job-experiences").InnerText(playwright.LocatorInnerTextOptions{
			Timeout: playwright.Float(1500),
		})
		description = desc + "\n\n" + skills
	}

	job := &scraper.Job{
		Title:       strings.TrimSpace(title),
		Company:     strings.TrimSpace(company),
		URL:         fullURL,
		Salary:      strings.TrimSpace(salary),
		Location:    strings.TrimSpace(location),
		Description: strings.ReplaceAll(description, "\n", ""),
		Source:      "ITViec",
		Techstack:   "Golang",
		PostedDate:  "Recent",
	}

	//check keyword presence in title/desc
	kLower := strings.ToLower(keyword)
	if !strings.Contains(strings.ToLower(job.Title), kLower) && !strings.Contains(strings.ToLower(job.Description), kLower) {
		return nil, fmt.Errorf("keyword not found in job title or description")
	}
	return job, nil
}
