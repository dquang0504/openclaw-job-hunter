package browser

import (
	"math/rand"
	"time"
	"github.com/playwright-community/playwright-go"
)
// RandomDelay waits for a random duration between min and max milliseconds
func RandomDelay(min, max int) {
	duration := rand.Intn(max-min+1) + min
	time.Sleep(time.Duration(duration) * time.Millisecond)
}
// HumanScroll simulates human-like scrolling behavior
func HumanScroll(page playwright.Page) error {
	// Scroll down in steps
	for i := 0; i < 5; i++ {
		_, err := page.Evaluate("window.scrollBy(0, window.innerHeight / 2)")
		if err != nil {
			return err
		}
		RandomDelay(500, 1500)
	}
	// Scroll back up a bit (random behavior)
	_, err := page.Evaluate("window.scrollBy(0, -200)")
	if err != nil {
		return err
	}
	return nil
}
// MouseJiggle simulates random mouse movements to prevent idle detection
func MouseJiggle(page playwright.Page) error {
	viewportSize := page.ViewportSize()
	if viewportSize == nil {
		return nil
	}
	width := viewportSize.Width
	height := viewportSize.Height
	// Move mouse to random coordinates a few times
	for i := 0; i < 3; i++ {
		x := rand.Intn(width)
		y := rand.Intn(height)
		if err := page.Mouse().Move(float64(x), float64(y)); err != nil {
			return err
		}
		RandomDelay(100, 300)
	}
	return nil
}