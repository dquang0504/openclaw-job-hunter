package filter

import (
	"go-openclaw-automation/internal/scraper"
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

var (
	keywordRegex    = regexp.MustCompile(`(?i)\b(golang|go\s+developer|go\s+backend|\bGo\b|blockchain)\b`)
	excludeRegex    = regexp.MustCompile(`(?i)\b(senior|lead|manager|principal|staff|architect|(\d{2,}|[3-9])\s*(\+|plus)?\s*years?|2\+\s*years?)\b`)
	includeRegex    = regexp.MustCompile(`(?i)\b(fresher|intern|junior|entry[\s-]?level|graduate|trainee)\b`)
	techStackRegex  = regexp.MustCompile(`(?i)\b(docker|kubernetes|aws|gcp|microservices|rest\s*api|grpc|backend|back-end|fullstack|full-stack)\b`)
	experienceRegex = regexp.MustCompile(`(?i)\b([3-9]|\d{2,})\s*(\+|plus)?\s*(năm|nam|years?|yoe|yrs?)\b`)
)

func CalculateMatchScore(job scraper.Job) int {
	score := 0
	//normalize text to remove accents
	text := normalizeText(job.Title + " " + job.Description + " " + job.Company)

	//golang mention (+3)
	if keywordRegex.MatchString(text) {
		score += 3
	}

	//Level match +3
	if includeRegex.MatchString(text) {
		score += 3
	}

	//location
	location := strings.ToLower(job.Location)
	if matchesPrimaryLocation(location) {
		score += 2
	} else if matchesSecondaryLocation(location) {
		score += 1
	}

	//tech stack bonus
	if techStackRegex.MatchString(text) {
		score += 1
	}

	//penalty: exp >= 3 years => -5
	if experienceRegex.MatchString(text) {
		return 0
	}

	//score normalizing
	if score > 10 {
		return 10
	}
	if score < 0 {
		return 0
	}
	return score
}

func normalizeText(str string) string {
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	result, _, _ := transform.String(t, str)
	return strings.ToLower(result)
}

func matchesPrimaryLocation(location string) bool {
	primary := []string{"cần thơ", "can tho", "remote", "từ xa", "hồ chí minh", "ho chi minh", "hcm", "saigon", "tphcm"}
	for _, loc := range primary {
		if strings.Contains(location, loc) {
			return true
		}
	}
	return false
}

// Currently not used
func matchesSecondaryLocation(location string) bool {
	return false
}
