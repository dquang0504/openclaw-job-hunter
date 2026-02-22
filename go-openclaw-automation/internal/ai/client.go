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
I will provide you with my Personal Knowledge Base (raw JSON containing all my skills, experiences, and education), and a Target Job Description.

Task:
1. You MUST output a tailored resume in a STRICT JSON format. Do NOT use the input JSON structure.
2. The output MUST EXACTLY follow this JSON structure:
{
  "personal_information": { "full_name": "", "job_title": "", "location": "", "email": "", "phone": "", "links": { "linkedin": "", "portfolio": "" } },
  "summary": "...",
  "skills": { "languages": [], "frontend": [], "backend": [], "databases": [], "devops_infra": [], "security": [] },
  "experience": [ { "role": "", "company": "", "location": "", "duration": "", "responsibilities": [], "tech_stack": [] } ],
  "projects": [ { "name": "", "url": "", "duration": "", "description": "", "details": [], "status": "" } ],
  "education": { "degree": "", "institution": "", "location": "", "graduation_year": "", "gpa": "" },
  "certifications": [ { "name": "", "band": 0, "details": "", "issuer": "", "year": 0 } ]
}
3. ADAPT THE JOB TITLE: Choose the most appropriate job title from my knowledge base to match the target role, or adapt it slightly (e.g., "Senior Backend Engineer").
4. AGGRESSIVE FILTERING: Select ONLY the skills, experiences, and projects from my knowledge base that align with the Job Description. Completely omit irrelevant information (e.g. drop Frontend skills for a Backend role).
5. REWRITE EXPERIENCES: Rewrite the 'summary' and the 'responsibilities' bullet points. Shift the focus heavily towards the required tech stack and keywords in the job description using strong action verbs.
6. NO HALLUCINATION: If the Job Description requires specific tools not in my knowledge base, do NOT lie. Emphasize related skills or fast learning ability instead.
7. Return ONLY a valid, raw JSON object representing the entire tailored resume. Do NOT wrap the JSON in markdown blocks (e.g., no ` + "`" + `json...` + "`" + `). Output just the literal JSON string starting with { and ending with }.`
}

// buildUserPrompt creates the user message combining the base resume and job description
func buildUserPrompt(baseResumeJSON, jobDescription string) string {
	return fmt.Sprintf("Personal Knowledge Base (JSON):\n%s\n\nJob Description:\n%s\n\nPlease output the tailored resume in EXACTLY the predefined target JSON structure.", baseResumeJSON, jobDescription)
}
