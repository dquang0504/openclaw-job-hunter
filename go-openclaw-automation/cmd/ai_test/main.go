package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"go-openclaw-automation/internal/ai"
)

func main() {
	apiKey := os.Getenv("GROK_API_KEY")
	if apiKey == "" {
		log.Println("GROK_API_KEY environment variable not set. Please set it to test the AI.")
		return
	}

	client := ai.NewGrokClient(apiKey)

	// Load the base resume
	baseResumeBytes, err := os.ReadFile("../../base-resume.json")
	if err != nil {
		log.Fatalf("Failed to read base-resume.json: %v", err)
	}

	jobDesc := `We are looking for a Senior Go Backend Developer.
Requirements: 
- 3+ years of experience with Go (Golang)
- Experience with Kafka and Redis
- Strong knowledge of PostgreSQL and microservices
- DevOps knowledge (Docker, CI/CD)`

	fmt.Println("Sending request to Grok AI to tailor the resume...")

	tailoredResume, err := client.TailorResume(context.Background(), string(baseResumeBytes), jobDesc)
	if err != nil {
		log.Fatalf("TailorResume failed: %v", err)
	}

	fmt.Println("\nSuccess! Tailored Resume Summary:")
	fmt.Println(tailoredResume.Summary)
}
