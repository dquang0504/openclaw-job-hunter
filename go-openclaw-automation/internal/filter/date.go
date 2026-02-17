package filter

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000

var (
	isoDateRegex  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`)
	yearOnlyRegex = regexp.MustCompile(`\b(20\d{2})\b`)
)

func IsRecentJob(dateStr string) bool {
	if dateStr == "" || dateStr == "N/A" || dateStr == "Recent" {
		return true
	}

	now := time.Now()
	var jobDate time.Time
	var err error

	//Case 1: ISO format "2026-01-27" or 2026-01-27T...
	if isoDateRegex.MatchString(dateStr) {
		jobDate, err = time.Parse("2006-01-02", dateStr[:10])
		if err == nil {
			return isWithin60Days(now, jobDate)
		}
	}

	//case 2: dd/mm/yyyy or mm/dd/yyyy
	if strings.Contains(dateStr, "/") {
		parts := strings.Split(dateStr, "/")
		if len(parts) >= 3 {
			day, _ := strconv.Atoi(parts[0])
			month, _ := strconv.Atoi(parts[1])
			year, _ := strconv.Atoi(parts[2])

			//assume dd/mm/yyyy
			jobDate = time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
			return isWithin60Days(now, jobDate)
		}
	}

	//case 3: year only fallback
	if match := yearOnlyRegex.FindStringSubmatch(dateStr); match != nil {
		year, _ := strconv.Atoi(match[1])
		validYears := []int{now.Year(), now.Year() - 1}
		for _, validYear := range validYears {
			if year == validYear {
				return true
			}
		}
		return false
	}

	//default
	return true
}

func isWithin60Days(now, jobDate time.Time) bool {
	diff := now.Sub(jobDate)
	//reject if older than 60 days
	if diff > 60*24*time.Hour {
		return false
	}

	//reject if future date >2 days (timezone issues)
	if diff < -2*24*time.Hour {
		return false
	}
	return true
}
