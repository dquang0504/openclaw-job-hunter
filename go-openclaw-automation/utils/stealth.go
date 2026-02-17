package utils

import (
	"math/rand"
	"time"

	"github.com/playwright-community/playwright-go"
)

// RandomDelay pauses execution for a random time between min and max (milliseconds)
func RandomDelay(min, max int) {
	if min >= max {
		time.Sleep(time.Duration(min) * time.Millisecond)
		return
	}
	duration := time.Duration(rand.Intn(max-min)+min) * time.Millisecond
	time.Sleep(duration)
}

// MouseJiggle simulates random mouse movements
func MouseJiggle(page playwright.Page) {
	//random position in viewport (0-1000)
	x := float64(rand.Intn(800) + 100) //100-900
	y := float64(rand.Intn(600) + 100) //100-700

	//move
	page.Mouse().Move(x, y)
	RandomDelay(100, 300)
}

// SmoothScroll simulates human scrolling behavior
func SmoothScroll(page playwright.Page) {
	// Scroll down a bit
	page.Mouse().Wheel(0, 500)
	RandomDelay(500, 1000)

	// Scroll up a tiny bit (human-like correction)
	page.Mouse().Wheel(0, -200)
	RandomDelay(500, 800)

	// Scroll to bottom to trigger lazy loading
	page.Evaluate("window.scrollTo(0, document.body.scrollHeight)")
}
