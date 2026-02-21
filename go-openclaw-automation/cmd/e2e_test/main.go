package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"go-openclaw-automation/internal/database"
	"go-openclaw-automation/internal/models"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(".env"); err != nil {
		godotenv.Load("../../.env")
	}

	dbURL := os.Getenv("DATABASE_URL")
	tgToken := os.Getenv("TELEGRAM_BOT_TOKEN")
	chatIDStr := os.Getenv("TELEGRAM_CHAT_ID")

	if dbURL == "" || tgToken == "" || chatIDStr == "" {
		log.Fatal("Missing DATABASE_URL, TELEGRAM_BOT_TOKEN, or TELEGRAM_CHAT_ID")
	}

	chatID, err := strconv.ParseInt(chatIDStr, 10, 64)
	if err != nil {
		log.Fatalf("Invalid TELEGRAM_CHAT_ID: %v", err)
	}

	// 1. Connect DB
	ctx := context.Background()
	repo, err := database.ConnectDB(ctx, dbURL)
	if err != nil {
		log.Fatalf("DB connection failed: %v", err)
	}
	defer repo.Close()

	// 2. Read base resume
	baseResumePath := "base-resume.json"
	if _, err := os.Stat(baseResumePath); os.IsNotExist(err) {
		baseResumePath = "../../base-resume.json"
	}
	baseResumeBytes, err := os.ReadFile(baseResumePath)
	if err != nil {
		log.Fatalf("Could not read base resume: %v", err)
	}

	// 3. Ensure User exists in DB
	user, err := repo.GetOrCreateUser(ctx, chatID, "TestUser", baseResumeBytes)
	if err != nil {
		log.Fatalf("Could not get/create user: %v", err)
	}

	// 4. Create a Fake Job to trigger the bot
	mockJob := &models.Job{
		Source:     "e2e_test",
		ExternalID: fmt.Sprintf("test-job-%d", time.Now().Unix()),
		Title:      "Senior Backend Engineer (Go/PostgreSQL)",
		Company:    "Google DeepMind",
		URL:        "https://google.com/careers",
		DescriptionRaw: `
			We are looking for a Senior Backend Engineer to build robust AI orchestration systems.
			Requirements:
			- Extensive experience in Go (Golang) and concurrent programming.
			- Deep understanding of PostgreSQL and database optimizations.
			- Experience with containerization technologies and Google Cloud Platform.
			- Knowledge of Playwright for scraping tools.
		`,
	}

	descSummary := "Focus on building robust AI orchestration, Go concurrency, DB optimization, and Playwright scraping."
	mockJob.DescriptionSummary = &descSummary

	savedJob, err := repo.SaveJob(ctx, mockJob)
	if err != nil {
		log.Fatalf("Could not save mock job: %v", err)
	}
	log.Printf("✅ DB Setup Complete. Job ID: %s, User ID: %s", savedJob.ID, user.ID)

	// 5. Send message with "Refine CV" button via Telegram BOT
	bot, err := tgbotapi.NewBotAPI(tgToken)
	if err != nil {
		log.Fatalf("Failed to initialize telegram bot: %v", err)
	}

	msgText := fmt.Sprintf("🔥 **New Job Alert (Test)**\n\n*Title:* %s\n*Company:* %s\n\n_Do you want AI to generate a tailored CV for this position?_", savedJob.Title, savedJob.Company)
	msg := tgbotapi.NewMessage(chatID, msgText)
	msg.ParseMode = "Markdown"

	// Inline Keyboard format for Telegram
	inlineKeyboard := tgbotapi.NewInlineKeyboardMarkup(
		tgbotapi.NewInlineKeyboardRow(
			tgbotapi.NewInlineKeyboardButtonData("✨ Tự động Tailor (Refine) CV", "refine_cv:"+savedJob.ID),
		),
	)
	msg.ReplyMarkup = inlineKeyboard

	if _, err := bot.Send(msg); err != nil {
		log.Fatalf("Failed to send message: %v", err)
	}

	log.Println("✅ Sent message to Telegram with 'Refine CV' button! Now, go to Telegram and click it!")
}
