package main

import (
	"context"
	"fmt"
	"go-openclaw-automation/internal/browser"
	"log"

	"github.com/playwright-community/playwright-go"
)

func main(){
	fmt.Println("🌐 Testing Browser Manager...")

	ctx := context.Background()

	//create playwright manager
	pm, err := browser.NewPlaywright(ctx)
	if err != nil {
		log.Fatalf("Failed to create Playwright: %v", err)
	}
	defer pm.Close()

	fmt.Println("✅ Playwright started")

	//load cookies
	cookies, err := browser.LoadCookies("../../.cookies/cookies-vercel.json")
	if err != nil {
		log.Fatalf("Failed to load cookies: %v", err)
	}

	fmt.Printf("✅ Loaded %d cookies\n", len(cookies))

	//create context with cookies
	browserCtx, err := pm.NewContext(cookies)
	if err != nil {
		log.Fatalf("Failed to create context: %v", err)
	}
	defer browserCtx.Close()

	fmt.Println("✅ Browser context created")

	//create page and navigate
	page, err := browserCtx.NewPage()
	if err != nil {
		log.Fatalf("Failed to create page: %v", err)
	}

	fmt.Println("🔍 Navigating to Vercel...")
	_, err = page.Goto("https://vercel.com/dquang0504s-projects/my-portfolio/analytics?period=24h")
	if err != nil {
		log.Fatalf("Failed to navigate: %v", err)
	}

	//Check if logged in
	title, _ := page.Title()
	fmt.Printf("✅ Page title: %s\n", title)
	
	//take screenshot
	_, err = page.Screenshot(playwright.PageScreenshotOptions{
		Path: playwright.String("vercel-test.png"),
	})
	if err != nil {
		log.Printf("Failed to take screenshot: %v", err)
	}else {
		fmt.Println("📸 Screenshot saved: facebook-test.png")
	}
	fmt.Println("✨ Test complete!")
}