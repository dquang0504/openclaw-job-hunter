package browser

import (
	"context"
	"log"

	"github.com/playwright-community/playwright-go"
)

type PlaywrightManager struct {
	pw      *playwright.Playwright
	browser playwright.Browser
}

//Todo: Tại sao tôi thấy bạn dùng playwright.Bool(true) mà không dùng true? Hai cái đó có gì khác nhau không ?
func NewPlaywright(ctx context.Context) (*PlaywrightManager, error) {
	//Install playwright
	err := playwright.Install();
	if err != nil {
		return nil, err
	}

	//start playwright
	pw, err := playwright.Run();
	if err != nil {
		return nil, err
	}

	//launch chromium
	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(true),
	})
	if err != nil {
		pw.Stop()
		return nil, err
	}

	return &PlaywrightManager{
		pw: pw,
		browser: browser,
	}, nil
}

//Todo: nó đang báo với mình lỗi cannot use ... in call to non-variadic ctx.AddCookiescompilerNonVariadicDotDotDot. Hướng dẫn mình sửa trong chat luôn nhé.

func (pm *PlaywrightManager) NewContext(cookies []playwright.Cookie) (playwright.BrowserContext, error) {
	//create context with stealth settings
	ctx, err := pm.browser.NewContext(playwright.BrowserNewContextOptions{
		UserAgent: playwright.String("Mozilla/5.0(Windows NT 10.0; Win64; x64 AppleWebKit/537.36)"),
		Viewport: &playwright.Size{
			Width: 1920,
			Height: 1080,
		},
	})
	if err != nil{
		return nil, err	
	}

	//add cookies
	if len(cookies) > 0{
		err = ctx.AddCookies(cookies...)
		if err != nil {
			ctx.Close()
			return nil, err
		}
	}
	return ctx, nil
}

func (pm *PlaywrightManager) Close() error {
	if pm.browser != nil {
		if err := pm.browser.Close(); err != nil{
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
