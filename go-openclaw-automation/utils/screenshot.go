package utils

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/playwright-community/playwright-go"
)

// ScreenshotDebugger handles debug screenshots
type ScreenShotDebugger struct {
	outputDir string
}

func NewScreenShotDebugger() *ScreenShotDebugger {
	dir := filepath.Join(".", "logs", "screenshots")
	os.MkdirAll(dir, 0755)
	return &ScreenShotDebugger{
		outputDir: dir,
	}
}

func (s *ScreenShotDebugger) CaptureAndLog(page playwright.Page, name, message string) error {
	timestamp := time.Now().Format("2006-01-02_15-04-05")
	filename := fmt.Sprintf("%s_%s.png", name, timestamp)
	filepath := filepath.Join(s.outputDir, filename)
	log.Printf("📸 %s", message)

	//Take screenshot
	_, err := page.Screenshot(playwright.PageScreenshotOptions{
		Path:     playwright.String(filepath),
		FullPage: playwright.Bool(true),
	})
	if err != nil {
		log.Printf("⚠️ Failed to capture screenshot: %v", err)
		return err
	}

	log.Printf("   Screenshot saved: %s", filepath)
	return nil
}
