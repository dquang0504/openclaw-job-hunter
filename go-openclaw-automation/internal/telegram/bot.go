package telegram

import (
	"fmt"
	"go-openclaw-automation/internal/scraper"
	"strings"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

type Bot struct {
	api    *tgbotapi.BotAPI
	chatID int64
}

func NewBot(token string, chatID int64) (*Bot, error) {
	api, err := tgbotapi.NewBotAPI(token)
	if err != nil {
		return nil, err
	}
	return &Bot{
		api:    api,
		chatID: chatID,
	}, nil
}

func (b *Bot) escapeMarkdown(text string) string {
	replacer := strings.NewReplacer(
		"_", "\\_", "*", "\\*", "[", "\\[", "]", "\\]", "(", "\\(",
		")", "\\)", "~", "\\~", "`", "\\`", ">", "\\>", "#", "\\#",
		"+", "\\+", "-", "\\-", "=", "\\=", "|", "\\|", "{", "\\{",
		"}", "\\}", ".", "\\.", "!", "\\!",
	)
	return replacer.Replace(text)
}

func (b *Bot) SendJob(job scraper.Job) error {
	//build message chunks
	msgText := fmt.Sprintf("🏢 *%s*\n", b.escapeMarkdown(job.Company))
	msgText += fmt.Sprintf("🔗 [View Job](%s)\n", job.URL)
	if job.Salary != "" {
		msgText += fmt.Sprintf("💰 %s\n", b.escapeMarkdown(job.Salary))
	}

	tech := job.Techstack
	if tech == "" {
		tech = "N/A"
	}
	msgText += fmt.Sprintf("📝 %s\n", b.escapeMarkdown(tech))

	loc := job.Location
	if loc == "" {
		loc = "N/A"
	}
	msgText += fmt.Sprintf("📍 %s\n", b.escapeMarkdown(loc))

	if job.PostedDate != "" {
		msgText += fmt.Sprintf("📅 %s\n", b.escapeMarkdown(job.PostedDate))
	}

	if (job.Source == "Facebook" || job.Source == "LinkedIn (Post)") && job.Description != "" {
		msgText += fmt.Sprintf("📄 %s\n", b.escapeMarkdown(job.Description))
	}

	msgText += fmt.Sprintf("🤖 Match Score: %d/10\n", job.MatchScore)
	msgText += fmt.Sprintf("🔖 Source: %s\n", b.escapeMarkdown(job.Source))

	//create inline keyboard
	keyboard := tgbotapi.NewInlineKeyboardMarkup(
		tgbotapi.NewInlineKeyboardRow(
			tgbotapi.NewInlineKeyboardButtonURL("🛠️ Refine CV", job.URL), tgbotapi.NewInlineKeyboardButtonURL("🔗 View Job", job.URL),
		),
	)

	msg := tgbotapi.NewMessage(b.chatID, msgText)
	msg.ParseMode = "MarkdownV2"
	msg.ReplyMarkup = keyboard

	_, err := b.api.Send(msg)
	return err
}

func (b *Bot) SendError(err error) error {
	msg := tgbotapi.NewMessage(b.chatID, fmt.Sprintf("❌ Error: %v", err))
	_, sendErr := b.api.Send(msg)
	return sendErr
}

func (b *Bot) SendStatus(message string) error {
	msg := tgbotapi.NewMessage(b.chatID, "ℹ️ "+message)
	_, err := b.api.Send(msg)
	return err
}
