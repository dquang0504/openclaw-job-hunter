package topcv

import (
	"context"
	"go-openclaw-automation/internal/config"
	"testing"
	"github.com/playwright-community/playwright-go"
	"github.com/stretchr/testify/assert"
)

//helper start mock browser
func setupPlaywright(t *testing.T) (*playwright.Playwright, playwright.Browser, playwright.Page) {
	pw, err := playwright.Run()
	if err != nil {
		t.Fatalf("could not launch playwright: %v", err)
	}
	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(false),
	})
	if err != nil {
		t.Fatalf("could not launch browser: %v", err)
	}
	page, err := browser.NewPage()
	if err != nil {
		t.Fatalf("could not create page: %v", err)
	}
	return pw, browser, page
}

func TestTopCVScraper_Scrape_Cloudflare(t *testing.T) {
	//Todo: implement mock test for cloudflare
	pw, browser, page := setupPlaywright(t);
	defer pw.Stop()
	defer browser.Close()

	//mock cloudflare page content
	mockHTML := `<html><title>Attention Required! | Cloudflare</title><body><h1>Please verify you are a human</h1></body></html>`

	//route all requests coming to topcv back to mock page
	page.Route("**/*", func(route playwright.Route){
		route.Fulfill(playwright.RouteFulfillOptions{
			Status: playwright.Int(200),
			Body: mockHTML,
		})
	})

	cfg := &config.Config{Keywords: []string{"test"}}
	scraper := NewTopCVScraper(cfg)

	//run scrape
	jobs, err := scraper.Scrape(context.Background(), page)

	assert.NoError(t, err)
	assert.Equal(t, 0, len(jobs), "Should return 0 jobs when Cloudflare blocks everything")
}

//integration test: run against real site
func TestTopCVScraper_Scrape_Real(t *testing.T) {
	//Todo: short mode là gì ? tại sao kiểm tra short rồi skip test ?
	if testing.Short(){
		t.Skip("Skipping integration test in short mode")
	}

	cfg := &config.Config{
		Keywords: []string{"golang"},
	}
	scraper := NewTopCVScraper(cfg)
	pw,browser, page := setupPlaywright(t)
	defer pw.Stop()
	defer browser.Close()

	jobs, err := scraper.Scrape(context.Background(), page)
	
	assert.NoError(t, err)
	assert.GreaterOrEqual(t, len(jobs), 0)
}