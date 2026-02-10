package main

import (
	"fmt"
	"go-openclaw-automation/internal/browser"
	"log"
)

func main() {
	fmt.Println("🍪 Testing cookie loading...")

	cookies, err := browser.LoadCookies("../.cookies/cookies-facebook.json")
	if err != nil{
		log.Fatalf("Failed to load cookies: %v", err)
	}

	fmt.Printf("✅ Loaded %d cookies\n", len(cookies))

	//Print first cookie as example
	if len(cookies) > 0{
		c := cookies[0]
		fmt.Printf("\nExample cookie:\n")
		fmt.Printf("Name: %s\n", c.Name)
		fmt.Printf("Value: %s\n", c.Value)
		fmt.Printf("Domain: %s\n", c.Domain)
		fmt.Printf("Secure: %t\n", c.Secure)
	}
}