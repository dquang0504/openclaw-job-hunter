package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"go-openclaw-automation/internal/scraper"
	"io"
	"net/http"
	"regexp"
	"strings"
)

var (
	hiringRegex = regexp.MustCompile(`(?i)\b(is hiring|we're hiring|now hiring|#hiring|job opening|open position|hiring for|recruiting|apply now|developer needed)\b`)
	personalRegex = regexp.MustCompile(`(?i)\b(i need|i('m| am) looking|i want|my job|just asking)\b`)
	golangRegex = regexp.MustCompile(`(?i)\b(golang|go\s*developer|go\s*backend|go\s*engineer)\b`)
)

//Validation struct holds the AI's verdict for a single job
type ValidationResult struct {
	IsValid bool
	Score int
	Reason string
	Location string
	PostedDate string
	TechStack string
}


//aiValidationItem is the JSON structure expected by the Groq API per job
type aiValidationItem struct {
	ID int `json:"id"`
	IsValid bool `json:"isValid"`
	Score int `json:"score"`
	Reason string `json:"reason"`
	Location string `json:"location"`
	PostedDate string `json:"postedDate"`
	TechStack string `json:"techStack"`
}

//BatchValidateJobsWithAI validates a batch of jobs using the Groq API
func (c *grokClient) BatchValidateJobsWithAI(ctx context.Context, jobs []scraper.Job) []ValidationResult {
	results := make([]ValidationResult, len(jobs))

	//prefill with regex fallback
	for i, job := range jobs {
		results[i] = regexValidate(job)
	}
	if len(jobs) == 0 {
		return results
	}

	//build compact job list for groq prompt
	var sb strings.Builder
	for i, job := range jobs {
		desc := job.Description
		if len(desc) > 150 {
			desc = desc[:150]
		}
		title := job.Title
		if len(title) > 80 {
			title = title[:80]
		}
		fmt.Fprintf(&sb, "[ID:%d] SOURCE: %s | TITLE: %s | DESC: %s\n", i, job.Source, title, desc)
	}
	//Todo: bạn giúp mình đánh giá mức độ dư thừa của cái AI Validation này đi, kiểu nó có thực sự cần thiết không á? và cái filter regex hiện tại với AI Validator này có đang bổ trợ cho nhau không ? 
	systemPrompt := `You are an expert Job Hunter AI. Your task is to analyze a list of job postings and filter for REAL Golang/Go software development jobs.
	
	Rules:
	1. Identify if it is a REAL Job Posting (Hiring) or just a discussion/spam.
	2. Ensure it is related to Golang (Go language).
	3. Score from 1-10 (10 = Perfect Golang Job match, 1 = Spam/Irrelevant).
	4. Extract key details: Location (CHECK DESCRIPTION CAREFULLY), Posted Date, Tech Stack.
	5. Ignore "looking for job" posts (candidates asking for work).
	6. CRITICAL. If the job requires more than 2 years of experience (e.g. 3+, 3-5 years, Senior), mark isValid = false.

	Output a JSON ARRAY ONLY. No markdown, no extra text.
	Format: [{"id": 0, "isValid": true, "score": 9, "reason": "Clear golang hiring", "location": "Remote", "postedDate": "2024-02-01", "techStack": "Go, AWS"}]
	`
	reqBody := grokRequest{
		Model: c.model,
		Messages: []grokMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: sb.String()},
		},
		Temperature: 0.1,
	}
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return results
	}

	req, err := http.NewRequestWithContext(ctx, "POST", grokURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return results
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+ c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return results
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != http.StatusOK{
		return results
	}
	
	//parse groq response
	var groqResp grokResponse
	if err := json.Unmarshal(bodyBytes, &groqResp); err != nil || len(groqResp.Choices) == 0{
		return results
	}
	rawContent := cleanMarkdownJSON(groqResp.Choices[0].Message.Content)
	parsed := parseValidationArray(rawContent)

	//Merge AI results back into results slice
	for _, item := range parsed {
		if item.ID >= 0 && item.ID < len(results) {
			score := item.Score
			if score < 1 {
				score = 1
			}
			if score > 10{
				score = 10
			}
			results[item.ID] = ValidationResult{
				IsValid: item.IsValid,
				Score: score,
				Reason: item.Reason,
				PostedDate: item.PostedDate,
				TechStack: item.TechStack,
			}
		}
	}
	return results
}

//parseValidationArray handles the case where Groq may return the array wrapped in an object like {"jobs":[...]} instead of a raw [...]
func parseValidationArray(raw string) []aiValidationItem{
	raw = strings.TrimSpace(raw)

	//try direct array parse first
	var items []aiValidationItem
	if err := json.Unmarshal([]byte(raw), &items); err == nil {
		return items
	}

	//try to extract array from a wrapper object
	//Todo: giải thích cho tôi và cho ví dụ cụ thể dễ hiểu hơn chỗ extract wrapper này đi
	var wrapper map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &wrapper); err == nil {
		for _, v := range wrapper {
			var nested []aiValidationItem
			if err := json.Unmarshal(v, &nested); err == nil {
				return nested
			}
		}
	}

	//last resort - find the first [...] block via strings
	//Todo: giải thích cho tôi hai method Index và LastIndex là gì và có tác dụng gì đi
	start := strings.Index(raw, "[")
	end := strings.LastIndex(raw, "]")
	if start != -1 && end > start {
		var items []aiValidationItem
		if err := json.Unmarshal([]byte(raw[start:end+1]), &items); err == nil{
			return items
		}
	}
	return nil
}

//regexValidate is the fallback when Groq is unavailable.
//mirrors the regexValidate closure in Node.js ai-filter.js
func regexValidate(job scraper.Job) ValidationResult{
	//linkedin / twitter posts already pre-filtered by the scraper
	src := strings.ToLower(job.Source)
	if strings.Contains(src, "linkedin") || strings.Contains(src, "twitter") {
		score := job.MatchScore
		if score == 0{
			score = 8
		}
		return ValidationResult{IsValid: true, Score: score, Reason: "pre-filtered"}
	}
	text := strings.ToLower(job.Title + " " + job.Description + " " + job.Company)
	score := 3
	if hiringRegex.MatchString(text) && !personalRegex.MatchString(text) {
		score += 3
	}
	if golangRegex.MatchString(text) {
		score += 3
	}
	if score > 10{
		score = 10
	}
	return ValidationResult{
		IsValid: score >= 6,
		Score: score,
		Reason: "regex",
	}
}

