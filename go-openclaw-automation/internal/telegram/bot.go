package telegram

import (
	"go-openclaw-automation/internal/scraper"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

type Bot struct {
	api    *tgbotapi.BotAPI
	chatID int64
}

func NewBot(token string, chatID int64) *Bot {
	api, _ := tgbotapi.NewBotAPI(token)
	return &Bot{
		api:    api,
		chatID: chatID,
	}
}

func (b *Bot) SendJob(job scraper.Job) error {

}

func (b *Bot) SendError(err error) error {

}
