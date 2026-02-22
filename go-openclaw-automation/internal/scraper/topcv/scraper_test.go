package topcv

import (
	"context"
	"go-openclaw-automation/internal/config"
	"testing"

	"github.com/playwright-community/playwright-go"
	"github.com/stretchr/testify/assert"
)

// setupPlaywright launches a real Chromium browser and returns a BrowserContext.
// Scrapers now create their own Pages from the context — they no longer receive a Page directly.
// The caller is responsible for defer browser.Close() and defer pw.Stop().
func setupPlaywright(t *testing.T) (*playwright.Playwright, playwright.Browser, playwright.BrowserContext) {
	t.Helper()

	pw, err := playwright.Run()
	if err != nil {
		t.Fatalf("could not launch playwright: %v", err)
	}

	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(true), // headless in tests to avoid opening windows
	})
	if err != nil {
		pw.Stop()
		t.Fatalf("could not launch browser: %v", err)
	}

	browserCtx, err := browser.NewContext()
	if err != nil {
		browser.Close()
		pw.Stop()
		t.Fatalf("could not create browser context: %v", err)
	}

	return pw, browser, browserCtx
}

// TestTopCVScraper_Scrape_Cloudflare verifies that when every response looks like a
// Cloudflare block page, Scrape returns 0 jobs and no error (graceful skip).
//
// Uses Playwright Route interception to intercept all network requests inside the
// BrowserContext and return a fake Cloudflare HTML response — no real network needed.
func TestTopCVScraper_Scrape_Cloudflare(t *testing.T) {
	pw, browser, browserCtx := setupPlaywright(t)
	defer pw.Stop()
	defer browser.Close()
	defer browserCtx.Close()

	// Intercept ALL requests in this context and return a fake Cloudflare block page
	mockHTML := `<html><title>Attention Required! | Cloudflare</title><body><h1>Please verify you are a human</h1></body></html>`
	if err := browserCtx.Route("**/*", func(route playwright.Route) {
		route.Fulfill(playwright.RouteFulfillOptions{
			Status: playwright.Int(200),
			Body:   mockHTML,
		})
	}); err != nil {
		t.Fatalf("could not set up route interception: %v", err)
	}

	cfg := &config.Config{Keywords: []string{"test"}}
	scraper := NewTopCVScraper(cfg)

	jobs, err := scraper.Scrape(context.Background(), browserCtx)

	assert.NoError(t, err, "Scrape should not return an error when Cloudflare blocks")
	assert.Equal(t, 0, len(jobs), "Should return 0 jobs when Cloudflare blocks everything")
}

// TestTopCVScraper_Scrape_NoJobs verifies that when the search results page shows
// the ".none-suitable-job" element, Scrape returns 0 jobs gracefully.
func TestTopCVScraper_Scrape_NoJobs(t *testing.T) {
	pw, browser, browserCtx := setupPlaywright(t)
	defer pw.Stop()
	defer browser.Close()
	defer browserCtx.Close()

	// Return a page that looks like a valid TopCV page but with no jobs
	mockHTML := `<html><title>TopCV</title><body><div class="none-suitable-job">Không tìm thấy việc làm phù hợp</div></body></html>`
	if err := browserCtx.Route("**/*", func(route playwright.Route) {
		route.Fulfill(playwright.RouteFulfillOptions{
			Status: playwright.Int(200),
			Body:   mockHTML,
		})
	}); err != nil {
		t.Fatalf("could not set up route interception: %v", err)
	}

	cfg := &config.Config{Keywords: []string{"golang"}}
	scraper := NewTopCVScraper(cfg)

	jobs, err := scraper.Scrape(context.Background(), browserCtx)

	assert.NoError(t, err)
	assert.Equal(t, 0, len(jobs), "Should return 0 jobs when no-jobs element is visible")
}

// TestTopCVScraper_Scrape_Real is an integration test that hits the real TopCV website.
//
// Why testing.Short()?
// Go's test runner supports a "-short" flag (go test -short ./...) that signals
// "skip any slow or external-dependency tests". Integration tests that open a real
// browser and make real network calls should always check testing.Short() and skip,
// so that CI pipelines can run fast unit tests without needing network access or time.
//
// Run this test manually with: go test -v -run TestTopCVScraper_Scrape_Real ./internal/scraper/topcv/
func TestTopCVScraper_Scrape_Real(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode (-short flag). Run without -short to execute.")
	}

	pw, browser, browserCtx := setupPlaywright(t)
	defer pw.Stop()
	defer browser.Close()
	defer browserCtx.Close()

	cfg := &config.Config{
		Keywords: []string{"golang"},
	}
	scraper := NewTopCVScraper(cfg)

	jobs, err := scraper.Scrape(context.Background(), browserCtx)

	assert.NoError(t, err)
	assert.GreaterOrEqual(t, len(jobs), 0, "Should return a non-negative number of jobs")
	t.Logf("Real scrape returned %d jobs", len(jobs))
}
