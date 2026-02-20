package ai

import (
	"context"
	"fmt"

	"go-openclaw-automation/internal/models"
)

// Client is the interface for AI providers
type Client interface {
	// TailorResume takes a JSON string of a base resume and a job description string,
	// and returns a tailored Resume object.
	TailorResume(ctx context.Context, baseResumeJSON string, jobDescription string) (*models.Resume, error)
}

// buildSystemPrompt creates the system instruction for the AI model
func buildSystemPrompt() string {
	return `You are an expert ATS-friendly resume writer.
I will provide you with my base master resume in JSON format, and a Job Description.

Task:
1. Keep the JSON structure EXACTLY the same. Key names must not change.
2. Keep the company names, durations, education, and certifications exactly as they are.
3. Rewrite the 'summary' and the 'responsibilities' bullet points under 'experience' and 'projects' to better match the keywords and tone of the Job Description. 
4. Do not lie or make up fake experience. Only highlight and rephrase the skills and experiences I already have to be more relevant to the specific job.
5. Return ONLY a valid, raw JSON object representing the entire tailored resume. 
6. Do NOT wrap the JSON in markdown blocks (e.g., no ` + "`" + `json...` + "`" + `). Output just the literal JSON string starting with { and ending with }.`
}

// buildUserPrompt creates the user message combining the base resume and job description
func buildUserPrompt(baseResumeJSON, jobDescription string) string {
	return fmt.Sprintf("Base Resume (JSON):\n%s\n\nJob Description:\n%s\n\nPlease output the tailored resume in EXACTLY the same JSON structure.", baseResumeJSON, jobDescription)
}
