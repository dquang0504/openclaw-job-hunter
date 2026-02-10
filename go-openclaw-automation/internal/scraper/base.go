// Define an interface for all scrapers
// Ensure consistency

package scraper

import "context"

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
	MatchScore string
}

type Scraper interface{
	//Scrape jobs from the platform
	Scrape(ctx context.Context) ([]Job, error)

	//Name of the scraper
	Name() string
}