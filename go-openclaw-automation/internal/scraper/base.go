// Define an interface for all scrapers
// Ensure consistency

package scraper

import (
	"context"

	"github.com/playwright-community/playwright-go"
)

type Job struct{
	Title string
	Company string
	URL string
	Location string
	Salary string
	Techstack string
	Description string
	Source string
	PostedDate string
	MatchScore int
}

//Scraper defines the interface that all platform scrapers must implement
type Scraper interface{
	//Scrape jobs from the platform
	Scrape(ctx context.Context, page playwright.Page) ([]Job, error)

	//Name is the platform name (TopCV, Facebook, ...)
	Name() string
}