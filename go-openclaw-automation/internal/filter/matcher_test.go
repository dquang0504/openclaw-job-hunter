package filter

import (
	"go-openclaw-automation/internal/scraper"
	"testing"
)

func TestCalculateMatchScore(t *testing.T) {
	tests := []struct{
		name string
		job scraper.Job
		expected int
	}{
		{
			name: "Perfect match",
			job: scraper.Job{
				Title: "Junior Golang Developer",
				Description: "Docker, Kubernetes, Remote",
				Location:  "Can Tho",
			},
			expected: 9,
		},
		{
			name: "Senior penalty",
			job: scraper.Job{
				Title: "Senior Golang Developer with 5 years exp",
				Description: "Remote",
			},
			expected: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			score := CalculateMatchScore(tt.job)
			if score != tt.expected {
				t.Errorf("got %d, want %d", score, tt.expected)
			}
		})
	}
}