package pdf

import (
	"bytes"
	"fmt"
	"html/template"
	"os"
	"path/filepath"
	"strings"

	"go-openclaw-automation/internal/models"

	"github.com/playwright-community/playwright-go"
)

// Generator is responsible for converting Resume models into localized PDF files
type Generator struct {
	templatePath string
}

// NewGenerator creates a new PDF generator with the given HTML template path
func NewGenerator(templatePath string) *Generator {
	return &Generator{
		templatePath: templatePath,
	}
}

// Generate takes a Resume model, parses it through the HTML template,
// and uses Playwright to render it as a PDF byte array.
func (g *Generator) Generate(resume *models.Resume) ([]byte, error) {
	// Parse the layout template
	// Add custom function "join" to be used in template for string slices
	funcMap := template.FuncMap{
		"join": strings.Join,
	}

	tmpl, err := template.New(filepath.Base(g.templatePath)).Funcs(funcMap).ParseFiles(g.templatePath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse template: %w", err)
	}

	// Execute template to a buffer
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, resume); err != nil {
		return nil, fmt.Errorf("failed to execute template: %w", err)
	}
	htmlContent := buf.String()

	// Use Playwright to render HTML to PDF
	pw, err := playwright.Run()
	if err != nil {
		return nil, fmt.Errorf("could not start playwright: %w", err)
	}
	// We must ensure playoff finishes
	defer pw.Stop()

	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("could not launch chromium browser: %w", err)
	}
	defer browser.Close()

	page, err := browser.NewPage()
	if err != nil {
		return nil, fmt.Errorf("could not create new page: %w", err)
	}
	defer page.Close()

	// Set the generated HTML content into the browser page
	if err := page.SetContent(htmlContent, playwright.PageSetContentOptions{
		WaitUntil: playwright.WaitUntilStateNetworkidle,
	}); err != nil {
		return nil, fmt.Errorf("could not set page content: %w", err)
	}

	// Generate the PDF
	pdfBytes, err := page.PDF(playwright.PagePdfOptions{
		Format:          playwright.String("A4"),
		PrintBackground: playwright.Bool(true),
		Margin: &playwright.Margin{
			Top:    playwright.String("0"),
			Bottom: playwright.String("0"),
			Left:   playwright.String("0"),
			Right:  playwright.String("0"),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("could not generate PDF: %w", err)
	}

	return pdfBytes, nil
}

// SaveToFile is a helper function to directly save generated PDF to disk
func SaveToFile(pdfBytes []byte, outputPath string) error {
	dir := filepath.Dir(outputPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("could not create directory: %w", err)
	}

	return os.WriteFile(outputPath, pdfBytes, 0644)
}
