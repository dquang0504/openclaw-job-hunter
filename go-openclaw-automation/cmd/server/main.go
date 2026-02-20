package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func main() {
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
		// TODO: Implement Telegram webhook handler
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	log.Printf("Server listening on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
