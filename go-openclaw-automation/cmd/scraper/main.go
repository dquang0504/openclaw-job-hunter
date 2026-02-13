package main

import (
	"context"
	"go-openclaw-automation/internal/browser"
	"log"
	"path/filepath"
	"time"
)

func main(){
	//setup context with timeout = 10 mins
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	log.Println("🚀 Starting OpenClaw Automation (Go version)...")

	//init playwright manager
	pwManager, err := browser.NewPlaywright(ctx)
	if err != nil {
		log.Fatalf("❌ Failed to init Playwright: %v", err)
	}
	//close playwright manager when application stops
	defer pwManager.Close()

	//load cookies
	//Todo: giải thích cho tôi hiểu cơ chế của filepath.join đi, tại sao không dùng đường dẫn đầy đủ để load luôn mà phải dùng .Join()
	cookiePath := filepath.Join("..", ".cookies", "cookies-facebook.json")
	log.Printf("🍪 Loading cookies from: %s", cookiePath)
	cookies, err := browser.LoadCookies(cookiePath);
	if err != nil {
		log.Printf("⚠️ Warning: Could not load cookies: %v. Continuing without cookies.", err)
	}

	//create new browser context with cookies
	browserCtx, err := pwManager.NewContext(cookies);
	if err != nil {
		log.Fatalf("❌ Failed to create browser context: %v", err)
	}

	//create new page
	page, err := browserCtx.NewPage();
	if err != nil {
		log.Fatalf("❌ Failed to create new page: %v", err)
	}
	log.Println("✅ Browser initialized successfully!")

	//navigate to verify
	log.Println("🌍 Navigating to Facebook to verify login...")
	if _, err := page.Goto("https://facebook.com"); err != nil {
		log.Printf("❌ Failed to load page: %v", err)
	}

	//wait for automated login
	time.Sleep(5 * time.Second)

	log.Println("🏁 Execution finished.")
}