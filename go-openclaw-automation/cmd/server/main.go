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
	log.Println("👂 Telegram polling started — waiting for button clicks...")

	for update := range updates {
		if update.CallbackQuery != nil {
			log.Printf("📲 Received CallbackQuery: data=%q from user=%d", update.CallbackQuery.Data, update.CallbackQuery.From.ID)
			go handleCallbackQuery(ctx, bot, repo, aiClient, update.CallbackQuery)
		} else {
			log.Printf("📨 Received update (type: message=%v)", update.Message != nil)
		}
	}
}

func handleCallbackQuery(ctx context.Context, bot *tgbotapi.BotAPI, repo *database.Repository, aiClient ai.Client, query *tgbotapi.CallbackQuery) {
	log.Printf("🔔 handleCallbackQuery called: data=%q", query.Data)

	// Acknowledge the callback immediately to remove loading state on button
	callback := tgbotapi.NewCallback(query.ID, "Đã nhận yêu cầu Refine CV...")
	if _, err := bot.Request(callback); err != nil {
		log.Printf("⚠️ Failed to acknowledge callback: %v", err)
	}

	chatID := query.Message.Chat.ID
	data := query.Data

	if !strings.HasPrefix(data, "refine_cv:") {
		log.Printf("⚠️ Unknown callback data: %q — ignoring", data)
		return
	}
	jobID := strings.TrimPrefix(data, "refine_cv:")
	log.Printf("🛠️ Processing Refine CV for jobID: %s", jobID)

	// Send initial tracking message (plain text — no ParseMode to avoid MarkdownV2 escape issues)
	msg := tgbotapi.NewMessage(chatID, fmt.Sprintf("⏳ Đang phân tích Job ID: %s...", jobID))
	sentMsg, err := bot.Send(msg)
	if err != nil {
		log.Printf("⚠️ Failed to send initial tracking message: %v", err)
		// Don't return — continue processing even if initial message fails
	}

	updateLog := func(text string) {
		if sentMsg.MessageID == 0 {
			// Fallback: send new message if initial send failed
			newMsg := tgbotapi.NewMessage(chatID, text)
			bot.Send(newMsg)
			return
		}
		editMsg := tgbotapi.NewEditMessageText(chatID, sentMsg.MessageID, text)
		bot.Send(editMsg)
	}

	log.Println("📚 Step 1: Reading base resume file...")
	baseResumePath := "base-knowledge.json"
	if _, err := os.Stat(baseResumePath); os.IsNotExist(err) {
		baseResumePath = "../../base-knowledge.json"
	}
	baseResumeBytes, err := os.ReadFile(baseResumePath)
	if err != nil {
		updateLog("❌ Lỗi: Không tìm thấy base-knowledge.json")
		return
	}
	log.Printf("📚 Base resume loaded (%d bytes)", len(baseResumeBytes))

	// Step 2: Get job from DB
	log.Printf("🗄️ Step 2: Fetching job %s from DB...", jobID)
	job, err := repo.GetJobByID(ctx, jobID)
	if err != nil {
		log.Printf("❌ GetJobByID failed: %v", err)
		updateLog("❌ Lỗi: Không lấy được thông tin Job từ Database.")
		return
	}
	log.Printf("✅ Job fetched: %s @ %s", job.Title, job.Company)

	// Step 3: Get or create user
	log.Println("👤 Step 3: GetOrCreateUser...")
	user, err := repo.GetOrCreateUser(ctx, query.From.ID, query.From.UserName, baseResumeBytes)
	if err != nil {
		log.Printf("❌ GetOrCreateUser failed: %v", err)
		updateLog("❌ Lỗi: Không thể khởi tạo User record.")
		return
	}
	log.Printf("✅ User: %s (ID=%s)", user.Username, user.ID)

	// Step 4: Upsert application state
	log.Println("📝 Step 4: UpsertApplication...")
	appConfig := &models.Application{
		UserID: user.ID,
		JobID:  job.ID,
		Status: models.StatusTailoring,
	}
	app, err := repo.UpsertApplication(ctx, appConfig)
	if err != nil {
		log.Printf("⚠️ UpsertApplication failed (non-fatal): %v", err)
		// Not fatal: continue without app record
	}

	// Step 5: Call AI
	log.Println("🧠 Step 5: Calling Groq AI TailorResume...")
	updateLog("🧠 AI Llama 3.3 70B đang viết lại resume theo JD...")

	jobDesc := job.Title + "\n\n" + job.DescriptionRaw
	if job.DescriptionSummary != nil {
		jobDesc = *job.DescriptionSummary
	}

	var resumeSource string
	if len(user.MasterResumeJSON) > 0 {
		resumeSource = string(user.MasterResumeJSON)
	} else {
		resumeSource = string(baseResumeBytes)
	}

	tailored, err := aiClient.TailorResume(ctx, resumeSource, jobDesc)
	if err != nil {
		log.Printf("❌ TailorResume failed: %v", err)
		updateLog(fmt.Sprintf("❌ Lỗi AI: %v", err))
		if app != nil {
			repo.UpdateApplicationStatus(ctx, app.ID, models.StatusFailed)
		}
		return
	}
	log.Println("✅ AI tailoring complete")

	// Step 6: Generate PDF
	log.Println("🎨 Step 6: Generating PDF with Playwright...")
	updateLog("🎨 Đang render PDF...")

	templatePath := "templates/resume.html"
	if _, err := os.Stat(templatePath); os.IsNotExist(err) {
		templatePath = "../../templates/resume.html"
	}
	pdfGen := pdf.NewGenerator(templatePath)
	pdfBytes, err := pdfGen.Generate(tailored)
	if err != nil {
		log.Printf("❌ PDF generation failed: %v", err)
		updateLog(fmt.Sprintf("❌ Lỗi render PDF: %v", err))
		if app != nil {
			repo.UpdateApplicationStatus(ctx, app.ID, models.StatusFailed)
		}
		return
	}
	log.Println("✅ PDF generated successfully")

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

	log.Println("📤 Step 7: Sending PDF to Telegram...")
	updateLog("📤 Gửi PDF hoàn thành!")

	fileReq := tgbotapi.FileBytes{
		Name:  fileName,
		Bytes: pdfBytes,
	}

	docMsg := tgbotapi.NewDocument(chatID, fileReq)
	docMsg.Caption = fmt.Sprintf("✅ Tạo CV thành công cho Cty %s!\n\nSummary:\n%s\n\nFile đã lưu tại: %s", job.Company, tailored.Summary, outputPath)

	if _, err := bot.Send(docMsg); err != nil {
		log.Printf("❌ Failed to send Document via TG: %v", err)
	} else {
		log.Println("✅ PDF sent to Telegram successfully!")
	}
}
