// cmd/update_resume/main.go
// One-off utility: update master_resume_json for all users in DB from base-knowledge.json
// Usage: go run ./cmd/update_resume/
package main

import (
	"context"
	"go-openclaw-automation/internal/config"
	"go-openclaw-automation/internal/database"
	"log"
	"os"
)

func main() {
	cfg := config.Load()

	resumePath := "base-knowledge.json"
	if _, err := os.Stat(resumePath); os.IsNotExist(err) {
		resumePath = "../../base-knowledge.json"
	}
	resumeBytes, err := os.ReadFile(resumePath)
	if err != nil {
		log.Fatalf("❌ Could not read %s: %v", resumePath, err)
	}
	log.Printf("📄 Loaded resume (%d bytes) from %s", len(resumeBytes), resumePath)

	ctx := context.Background()
	repo, err := database.ConnectDB(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("❌ DB connect failed: %v", err)
	}
	defer repo.Close()

	// Update ALL users (for single-user setup this is fine)
	rowsAffected, err := repo.UpdateAllUsersResume(ctx, resumeBytes)
	if err != nil {
		log.Fatalf("❌ Failed to update: %v", err)
	}
	log.Printf("✅ Updated master_resume_json for %d user(s)", rowsAffected)
}
