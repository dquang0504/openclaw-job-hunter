package browser

import (
	"context"

	"github.com/playwright-community/playwright-go"
)

type PlaywrightManager struct {
	pw      *playwright.Playwright
	browser playwright.Browser
}

func NewPlaywright(ctx context.Context) *PlaywrightManager {

}

func (pm *PlaywrightManager) NewContext(cookies []Cookie) (playwright.BrowserContext, error) {

}

func (pm *PlaywrightManager) Close() error {

}
