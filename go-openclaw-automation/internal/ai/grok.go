package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"go-openclaw-automation/internal/models"
)

const grokURL = "https://api.groq.com/openai/v1/chat/completions"

type grokClient struct {
	apiKey     string
	model      string
	httpClient *http.Client
}

// NewGrokClient creates a new xAI Grok API client (now using Groq under the hood)
func NewGrokClient(apiKey string) Client {
	return &grokClient{
		apiKey:     apiKey,
		model:      "llama-3.3-70b-versatile", // Using Groq's super fast Llama-3 model
		httpClient: &http.Client{},
	}
}

type grokMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type grokRequest struct {
	Model       string        `json:"model"`
	Messages    []grokMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
}

type grokResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// TailorResume sends the base resume and job description to Grok to tailor the resume
func (c *grokClient) TailorResume(ctx context.Context, baseResumeJSON string, jobDescription string) (*models.Resume, error) {
	reqBody := grokRequest{
		Model: c.model,
		Messages: []grokMessage{
			{
				Role:    "system",
				Content: buildSystemPrompt(),
			},
			{
				Role:    "user",
				Content: buildUserPrompt(baseResumeJSON, jobDescription),
			},
		},
		Temperature: 0.3, // Low temperature for consistency
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal grok request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", grokURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create http request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("grok API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var grokResp grokResponse
	if err := json.Unmarshal(bodyBytes, &grokResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if grokResp.Error != nil {
		return nil, fmt.Errorf("API error: %s", grokResp.Error.Message)
	}

	if len(grokResp.Choices) == 0 {
		return nil, fmt.Errorf("no choices returned from grok API")
	}

	// Clean the response from potential markdown wrappers
	rawContent := grokResp.Choices[0].Message.Content
	cleanedJSON := cleanMarkdownJSON(rawContent)

	// Finally, parse the tailored JSON into our model struct
	var tailored models.Resume
	if err := json.Unmarshal([]byte(cleanedJSON), &tailored); err != nil {
		return nil, fmt.Errorf("failed to unmarshal AI response to Resume struct (raw length: %d): %w", len(cleanedJSON), err)
	}

	return &tailored, nil
}

// cleanMarkdownJSON removes backticks and "json" prefix if the AI model tries to be helpful
func cleanMarkdownJSON(content string) string {
	content = strings.TrimSpace(content)
	if strings.HasPrefix(content, "```json") {
		content = strings.TrimPrefix(content, "```json")
		content = strings.TrimSuffix(content, "```")
	} else if strings.HasPrefix(content, "```") {
		content = strings.TrimPrefix(content, "```")
		content = strings.TrimSuffix(content, "```")
	}
	return strings.TrimSpace(content)
}
