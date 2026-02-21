package models

import (
	"time"
)

type ApplicationStatus string

const (
	StatusScanned   ApplicationStatus = "SCANNED"
	StatusTailoring ApplicationStatus = "TAILORING"
	StatusCompleted ApplicationStatus = "COMPLETED"
	StatusFailed    ApplicationStatus = "FAILED"
)

type User struct {
	ID               string    `json:"id"`
	TelegramID       int64     `json:"telegram_id"`
	Username         string    `json:"username"`
	MasterResumeJSON []byte    `json:"master_resume_json"` // Raw JSONB
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type Job struct {
	ID                 string    `json:"id"`
	Source             string    `json:"source"`
	ExternalID         string    `json:"external_id"`
	Title              string    `json:"title"`
	Company            string    `json:"company"`
	URL                string    `json:"url"`
	DescriptionRaw     string    `json:"description_raw"`
	DescriptionSummary *string   `json:"description_summary,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
}

type Application struct {
	ID                 string            `json:"id"`
	UserID             string            `json:"user_id"`
	JobID              string            `json:"job_id"`
	Status             ApplicationStatus `json:"status"`
	TailoredResumeJSON []byte            `json:"tailored_resume_json,omitempty"` // Raw JSONB
	MatchScore         *int              `json:"match_score,omitempty"`
	CoverLetter        *string           `json:"cover_letter,omitempty"`
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
}
