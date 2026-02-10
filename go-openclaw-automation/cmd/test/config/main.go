package main
import (
	"fmt"
	"go-openclaw-automation/internal/config"
)
func main() {
	fmt.Println("🔧 Testing config loading...")
	cfg := config.Load()
	fmt.Printf("✅ Config loaded successfully!\n")
	fmt.Printf("   Telegram Token: %s...\n", cfg.TelegramToken[:10])
	fmt.Printf("   Telegram Chat ID: %d\n", cfg.TelegramChatID)
	fmt.Printf("   Keywords: %v\n", cfg.Keywords)
	fmt.Printf("   Locations: %v\n", cfg.Locations)
	fmt.Printf("   Facebook Groups: %d groups\n", len(cfg.FacebookGroups))
	fmt.Printf("   Cookies Path: %s\n", cfg.CookiesPath)
}