package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"go-openclaw-automation/internal/ai"
	"go-openclaw-automation/internal/database"
	"go-openclaw-automation/internal/models"
	"go-openclaw-automation/internal/pdf"

	"github.com/gin-gonic/gin"
	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(".env"); err != nil {
		godotenv.Load("../../.env")
	}

	dbURL := os.Getenv("DATABASE_URL")
	tgToken := os.Getenv("TELEGRAM_BOT_TOKEN")
	aiKey := os.Getenv("GROQ_API_KEY")

	if dbURL == "" || tgToken == "" || aiKey == "" {
		log.Println("⚠️ Missing critical Environment Variables (DATABASE_URL, TELEGRAM_BOT_TOKEN, GROQ_API_KEY). Check .env")
	}

	// 1. Initialize Database
	ctx := context.Background()
	repo, err := database.ConnectDB(ctx, dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer repo.Close()
	log.Println("✅ Database Connected")

	// 2. Initialize Telegram Bot
	bot, err := tgbotapi.NewBotAPI(tgToken)
	if err != nil {
		log.Fatalf("Failed to initialize telegram bot: %v", err)
	}
	log.Printf("✅ Authorized on Telegram account %s", bot.Self.UserName)

	// 3. Initialize AI Client
	aiClient := ai.NewGrokClient(aiKey)

	// 4. Start Telegram Polling in background for Local/Worker interactions
	go startTelegramPolling(ctx, bot, repo, aiClient)

	// 5. Start HTTP Server (useful for Cloud Run Health checks and future webhooks)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "OpenClaw Job Hunter API is running!", "status": "healthy"})
	})

	log.Printf("Server listening on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func startTelegramPolling(ctx context.Context, bot *tgbotapi.BotAPI, repo *database.Repository, aiClient ai.Client) {
	u := tgbotapi.NewUpdate(0)
	u.Timeout = 60

	updates := bot.GetUpdatesChan(u)

	for update := range updates {
		if update.CallbackQuery != nil {
			go handleCallbackQuery(ctx, bot, repo, aiClient, update.CallbackQuery)
		}
	}
}

func handleCallbackQuery(ctx context.Context, bot *tgbotapi.BotAPI, repo *database.Repository, aiClient ai.Client, query *tgbotapi.CallbackQuery) {
	// Acknowledge the callback immediately to remove loading state on button
	callback := tgbotapi.NewCallback(query.ID, "Đã nhận yêu cầu Refine CV...")
	bot.Request(callback)

	chatID := query.Message.Chat.ID
	data := query.Data

	if !strings.HasPrefix(data, "refine_cv:") {
		return
	}
	jobID := strings.TrimPrefix(data, "refine_cv:")

	// Send initial tracking message
	msg := tgbotapi.NewMessage(chatID, fmt.Sprintf("⏳ Đang phân tích Job ID: `%s` và gọi hệ thống AI (Groq)...", jobID))
	msg.ParseMode = "MarkdownV2"
	sentMsg, _ := bot.Send(msg)

	updateLog := func(text string) {
		editMsg := tgbotapi.NewEditMessageText(chatID, sentMsg.MessageID, text)
		editMsg.ParseMode = "Markdown"
		bot.Send(editMsg)
	}

	// Read User Base Resume (Fallback to local file if not DB yet for testing phase)
	// In production, fetch from repo.GetUser
	baseResumePath := "base-resume.json"
	if _, err := os.Stat(baseResumePath); os.IsNotExist(err) {
		baseResumePath = "../../base-resume.json"
	}
	baseResumeBytes, err := os.ReadFile(baseResumePath)
	if err != nil {
		updateLog("❌ Lỗi: Không tìm thấy `base-resume.json` của user.")
		return
	}

	// 1. Verify Job in DB
	job, err := repo.GetJobByID(ctx, jobID)
	if err != nil {
		updateLog("❌ Lỗi: Không lấy được thông tin Job từ Database.")
		return
	}

	// 2. Register Application State in DB
	user, err := repo.GetOrCreateUser(ctx, query.From.ID, query.From.UserName, baseResumeBytes)
	if err != nil {
		updateLog("❌ Lỗi: Không thể khởi tạo User record.")
		return
	}

	appConfig := &models.Application{
		UserID: user.ID,
		JobID:  job.ID,
		Status: models.StatusTailoring,
	}
	app, err := repo.UpsertApplication(ctx, appConfig)
	if err != nil {
		log.Printf("Failed to upsert application: %v\n", err) // Not a fatal error to continue
	}

	// 3. Tailor with AI
	updateLog("🧠 AI *Llama 3.3 70B* đang tính toán keyword và viết lại tóm tắt, kinh nghiệm làm việc...")

	jobDesc := job.Title + "\n\n" + job.DescriptionRaw
	if job.DescriptionSummary != nil {
		jobDesc = *job.DescriptionSummary
	}

	tailored, err := aiClient.TailorResume(ctx, string(baseResumeBytes), jobDesc)
	if err != nil {
		updateLog(fmt.Sprintf("❌ Lỗi AI: `%v`", err))
		if app != nil {
			repo.UpdateApplicationStatus(ctx, app.ID, models.StatusFailed)
		}
		return
	}

	// 4. Generate PDF
	updateLog("🎨 Đang dùng Playwright render giao diện PDF siêu đẹp chuẩn ATS...")

	templatePath := "templates/resume.html"
	if _, err := os.Stat(templatePath); os.IsNotExist(err) {
		templatePath = "../../templates/resume.html"
	}
	pdfGen := pdf.NewGenerator(templatePath)
	pdfBytes, err := pdfGen.Generate(tailored)
	if err != nil {
		updateLog(fmt.Sprintf("❌ Lỗi render PDF: `%v`", err))
		if app != nil {
			repo.UpdateApplicationStatus(ctx, app.ID, models.StatusFailed)
		}
		return
	}

	// 5. Save PDF File to filesystem (resumes directory)
	resumeDir := "resumes"
	if _, err := os.Stat(resumeDir); os.IsNotExist(err) {
		resumeDir = "../../resumes"
	}
	os.MkdirAll(resumeDir, 0755)

	fileName := fmt.Sprintf("Tailored_%s_OpenClaw.pdf", strings.ReplaceAll(job.Company, " ", "_"))
	outputPath := filepath.Join(resumeDir, fileName)
	if err := pdf.SaveToFile(pdfBytes, outputPath); err != nil {
		log.Printf("Failed to save PDF locally: %v", err)
	}

	// Update DB Application state to COMPLETED (Store tailored JSON optionally later)
	if app != nil {
		repo.UpdateApplicationStatus(ctx, app.ID, models.StatusCompleted)
	}

	// 6. Send PDF to Telegram
	updateLog("📤 Gửi PDF hoàn thành. Chuẩn bị tài liệu!")

	fileReq := tgbotapi.FileBytes{
		Name:  fileName,
		Bytes: pdfBytes,
	}

	docMsg := tgbotapi.NewDocument(chatID, fileReq)
	docMsg.Caption = fmt.Sprintf("✅ **Tạo CV thành công cho Cty %s!**\n\n*Summary AI viết ra:*\n_%s_\n\n👉 File đã lưu cục bộ tại `%s`", job.Company, tailored.Summary, outputPath)
	docMsg.ParseMode = "Markdown"

	if _, err := bot.Send(docMsg); err != nil {
		log.Printf("Failed to send Document via TG: %v\n", err)
	}
}
