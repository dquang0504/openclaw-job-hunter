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
I will provide you with my base master resume in JSON format, and a Target Job Description.

Task:
1. Keep the JSON structure EXACTLY the same. Key names must not change. Keep company names, durations, education, and certifications exactly as they are.
2. ADAPT THE JOB TITLE: Change my 'job_title' in personal_information to match the target role (e.g., if applying for a Backend role, change "Fullstack Developer" to "Backend Developer" or "Senior Backend Engineer").
3. AGGRESSIVE FILTERING: Remove any skills, tech stacks (like Frontend), or irrelevant projects that do NOT align with the Job Description. If the job only needs Backend, completely remove Frontend skills from the output.
4. REWRITE EXPERIENCES: Rewrite the 'summary' and the 'responsibilities' bullet points under 'experience' and 'projects'. Shift the focus heavily towards the required tech stack and keywords in the job description. Do not make up fake experience, but re-prioritize and deeply tailor the existing experiences.
5. Return ONLY a valid, raw JSON object representing the entire tailored resume. Do NOT wrap the JSON in markdown blocks (e.g., no ` + "`" + `json...` + "`" + `). Output just the literal JSON string starting with { and ending with }.`
}

// buildUserPrompt creates the user message combining the base resume and job description
func buildUserPrompt(baseResumeJSON, jobDescription string) string {
	return fmt.Sprintf("Base Resume (JSON):\n%s\n\nJob Description:\n%s\n\nPlease output the tailored resume in EXACTLY the same JSON structure.", baseResumeJSON, jobDescription)
}
