package filter

import (
	"go-openclaw-automation/internal/scraper"
	"strings"
)

func ShouldIncludeJob(job scraper.Job) bool {
	text := strings.ToLower(job.Title + " " + job.Description)
	//must contain golang/go
	if !keywordRegex.MatchString(text){
		return false
	}

	//must not contain exclude keywords
	if excludeRegex.MatchString(text) {
		return false
	}

	//must not have >= 3 years exp
	if experienceRegex.MatchString(text) {
		return false
	}

	//must be recent (<= 60 days)
	if !IsRecentJob(job.PostedDate) {
		return false
	}

	return true
}