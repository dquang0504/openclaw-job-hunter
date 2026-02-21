package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"go-openclaw-automation/internal/ai"
	"go-openclaw-automation/internal/pdf"

	"github.com/joho/godotenv"
)

func main() {
	// Attempt to load .env from current directory or parent directories
	if err := godotenv.Load(".env"); err != nil {
		godotenv.Load("../../.env") // Fallback for running from within cmd/ai_test
	}

	apiKey := os.Getenv("GROQ_API_KEY")
	if apiKey == "" {
		log.Println("GROQ_API_KEY environment variable not set. Please set it to test the AI.")
		return
	}

	client := ai.NewGrokClient(apiKey)

	// Load the base resume
	baseResumeBytes, err := os.ReadFile("base-resume.json")
	if err != nil {
		baseResumeBytes, err = os.ReadFile("../../base-resume.json")
		if err != nil {
			log.Fatalf("Failed to read base-resume.json: %v", err)
		}
	}

	// Job description content
	jobDesc := `We are looking for a Senior Go Backend Developer.
Requirements: 
- 3+ years of experience with Go (Golang)
- Experience with Kafka and Redis
- Strong knowledge of PostgreSQL and microservices
- DevOps knowledge (Docker, CI/CD)`

	// Optional: read job description from command line file if provided
	if len(os.Args) > 1 {
		jdBytes, err := os.ReadFile(os.Args[1])
		if err != nil {
			log.Printf("Could not read JD from file %s. Using default. Error: %v\n", os.Args[1], err)
		} else {
			jobDesc = string(jdBytes)
			fmt.Printf("Loaded Custom Job Description from: %s\n", os.Args[1])
		}
	}

	fmt.Println("Sending request to Grok AI to tailor the resume...")

	tailoredResume, err := client.TailorResume(context.Background(), string(baseResumeBytes), jobDesc)
	if err != nil {
		log.Fatalf("TailorResume failed: %v", err)
	}

	fmt.Println("\nSuccess! Tailored Resume Summary generated.")
	fmt.Println("Now Generating PDF Profile...")

	// PDF Generation stage
	templatePath := "templates/resume.html"
	if _, err := os.Stat(templatePath); os.IsNotExist(err) {
		templatePath = "../../templates/resume.html" // Fallback lookup
	}

	pdfGenerator := pdf.NewGenerator(templatePath)
	pdfBytes, err := pdfGenerator.Generate(tailoredResume)
	if err != nil {
		log.Fatalf("Failed to generate PDF: %v", err)
	}

	// Output logic
	outputFile := "../../logs/output_resume.pdf"
	if err := pdf.SaveToFile(pdfBytes, outputFile); err != nil {
		outputFile = "output_resume.pdf" // Save current dir if fallback failed
		if err := pdf.SaveToFile(pdfBytes, outputFile); err != nil {
			log.Fatalf("Could not save PDF to file: %v", err)
		}
	}

	fmt.Printf("✅ Beautiful Resume PDF tailored and saved to: %s\n", outputFile)
}
