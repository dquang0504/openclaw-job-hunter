package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"go-openclaw-automation/internal/ai"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// Attempt to load .env from current directory or parent directories
	if err := godotenv.Load(".env"); err != nil {
		godotenv.Load("../../.env")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "OpenClaw Job Hunter API is running!",
			"status":  "healthy",
		})
	})

	r.POST("/webhook/telegram", func(c *gin.Context) {
		// Example simplistic handler for integrating AI logic
		var payload struct {
			JobDescription string `json:"job_description"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if payload.JobDescription == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "job_description is required"})
			return
		}

		// Read base resume
		baseResume, err := os.ReadFile("base-resume.json")
		if err != nil {
			// fallback check from cmd directory if running differently
			baseResume, err = os.ReadFile("../../base-resume.json")
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read base resume"})
				return
			}
		}

		// Init AI client (Using Grok per plan)
		apiKey := os.Getenv("GROQ_API_KEY")
		if apiKey == "" {
			log.Println("GROQ_API_KEY missing. Cannot tailor resume.")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "AI not configured"})
			return
		}

		aiClient := ai.NewGrokClient(apiKey)

		// Async or blocking tailoring process
		go func() {
			log.Println("Starting AI resume tailoring process...")
			// TODO: in a real webhook, this runs asynchronously or within an orchestrator worker
			tailored, err := aiClient.TailorResume(context.Background(), string(baseResume), payload.JobDescription)
			if err != nil {
				log.Printf("AI tailoring Failed: %v\n", err)
				return
			}
			log.Println("AI Tailoring Success! New Resume summary:", tailored.Summary)
			// TODO: Add the next step here -> Generation of PDF & Sending back to Telegram
		}()

		c.JSON(http.StatusOK, gin.H{"status": "processing"})
	})

	log.Printf("Server listening on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
