package browser

import (
	"context"
	"fmt"
	"log"

	"github.com/playwright-community/playwright-go"
)

type PlaywrightManager struct {
	pw      *playwright.Playwright
	browser playwright.Browser
}

func NewPlaywright(ctx context.Context) (*PlaywrightManager, error) {
	//Install playwright
	err := playwright.Install()
	if err != nil {
		return nil, fmt.Errorf("could not install playwright: %w", err)
	}

	//start playwright
	pw, err := playwright.Run()
	if err != nil {
		return nil, fmt.Errorf("could not run playwright: %w", err)
	}

	//launch chromium (stealth args explained in LEARNING-04.md)
	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(false),
		Timeout:  playwright.Float(60000),
		Args: []string{
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-blink-features=AutomationControlled", //anti detection
			"--disable-infobars",
			"--window-size=1280,800",
			"--disable-accelerated-2d-canvas",
			"--disable-gpu",
			"--no-first-run",
			"--no-service-autorun",
			"--password-store=basic",
		},
		IgnoreDefaultArgs: []string{"--enable-automation"}, //hide "chrome is being controlled by automated software"
	})
	if err != nil {
		pw.Stop()
		return nil, fmt.Errorf("could not launch browser: %w", err)
	}

	return &PlaywrightManager{
		pw:      pw,
		browser: browser,
	}, nil
}

// NewContext creates a browser context with human-like settings (UserAgent explained in LEARNING-04.md)
func (pm *PlaywrightManager) NewContext(cookies []playwright.OptionalCookie) (playwright.BrowserContext, error) {
	//create context with stealth settings
	ctx, err := pm.browser.NewContext(playwright.BrowserNewContextOptions{
		UserAgent: playwright.String("Mozilla/5.0(Windows NT 10.0; Win64; x64 AppleWebKit/537.36) (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"),
		Viewport: &playwright.Size{
			Width:  1280,
			Height: 800,
		},
		Locale:            playwright.String("vi-VN"),
		TimezoneId:        playwright.String("Asia/Ho_Chi_Minh"),
		JavaScriptEnabled: playwright.Bool(true),
	})
	if err != nil {
		return nil, err
	}

	//add cookies
	if len(cookies) > 0 {
		err = ctx.AddCookies(cookies)
		if err != nil {
			ctx.Close()
			return nil, fmt.Errorf("could not add cookies: %w", err)
		}
	}
	return ctx, nil
}

func (pm *PlaywrightManager) Close() error {
	if pm.browser != nil {
		if err := pm.browser.Close(); err != nil {
			log.Printf("Error closing browser: %v", err)
		}
	}
	if pm.pw != nil {
		if err := pm.pw.Stop(); err != nil {
			log.Printf("Error stopping Playwright: %v", err)
		}
	}
	return nil
}
