package browser

import (
	"encoding/json"
	"os"

	"github.com/playwright-community/playwright-go"
)

//Cookie struct represents a browser cookie from JSON file
type Cookie struct{
	Name string `json:"name"`
	Value string `json:"value"`
	Domain string `json:"domain"`
	Path string `json:"path"`
	Expires float64 `json:"expires"`
	HTTPOnly bool `json:"httpOnly"`
	Secure bool `json:"secure"`
	SameSite string `json:"sameSite"`
}

func LoadCookies(path string) ([]playwright.Cookie, error){
	data, err := os.ReadFile(path)
	if err != nil{
		return nil, err
	}

	var cookies []Cookie
	if err := json.Unmarshal(data, &cookies); err != nil{
		return nil, err
	}

	pwCookies := make([]playwright.Cookie, len(cookies))
	for i, c := range cookies{
		pwCookies[i] = c.ToPlayWright()
	}
	return pwCookies, nil
}

func (c Cookie) ToPlayWright() playwright.Cookie {
	pwCookie := playwright.Cookie{
		Name: c.Name,
		Value: c.Value,
		Domain: *playwright.String(c.Domain),
		Path: *playwright.String(c.Path),
	}
    
	if c.Expires > 0 {
		pwCookie.Expires = *playwright.Float(c.Expires)
	}

	if c.HTTPOnly {
		pwCookie.HttpOnly = *playwright.Bool(true)

	}

	if c.Secure{
		pwCookie.Secure = *playwright.Bool(true)
	}

	switch c.SameSite{
	case "Lax":
		pwCookie.SameSite = playwright.SameSiteAttributeLax
	case "Strict":
		pwCookie.SameSite = playwright.SameSiteAttributeStrict
	case "None":
		pwCookie.SameSite = playwright.SameSiteAttributeNone
	}

	return pwCookie
}