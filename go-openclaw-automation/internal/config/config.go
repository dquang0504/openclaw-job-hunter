// Load envs from .env
// Load YAML config
// Validate config
// Provide default values

package config

import (
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
	"gopkg.in/yaml.v3"
)

type Config struct {
	TelegramToken  string   `yaml:"telegram_token" env:"TELEGRAM_BOT_TOKEN"`
	TelegramChatID int64    `yaml:"telegram_chat_id" env:"TELEGRAM_CHAT_ID"`
	Keywords       []string `yaml:"keywords"`
	//Search criteria
	Locations      []string `yaml:"locations"`
	FacebookGroups []string `yaml:"facebook_groups"`
	//Paths
	CookiesPath string `yaml:"cookies_path"`
	CachePath   string `yaml:"cache_path"`
}

func Load() *Config {
	_ = godotenv.Load()

	//Load yaml config
	cfg := &Config{}

	data, err := os.ReadFile("configs/config.yaml")
	if err != nil {
		log.Printf("Warning: Could not read config.yaml: %v", err)
	} else {
		if err := yaml.Unmarshal(data, cfg); err != nil {
			log.Fatalf("Error parsing config.yaml: %v", err)
		}
	}

	//Override with env vars
	if token := os.Getenv("TELEGRAM_BOT_TOKEN"); token != "" {
		cfg.TelegramToken = token
	}

	if chatID := os.Getenv("TELEGRAM_CHAT_ID"); chatID != "" {
		id, err := strconv.ParseInt(chatID, 10, 64)
		if err != nil {
			log.Fatalf("Invalid TELEGRAM_CHAT_ID: %v", err)
		}
		cfg.TelegramChatID = id
	}

	//Set default values if not set
	if cfg.CookiesPath == "" {
		cfg.CookiesPath = "../.cookies"
	}

	if cfg.CachePath == "" {
		cfg.CachePath = "../.cache"
	}

	//Validate required fields
	if cfg.TelegramToken == "" {
		log.Fatal("TELEGRAM_BOT_TOKEN is required")
	}

	if cfg.TelegramChatID == 0 {
		log.Fatal("TELEGRAM_CHAT_ID is required")
	}

	return cfg
}
