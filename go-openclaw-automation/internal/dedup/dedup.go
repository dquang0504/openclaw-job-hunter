package dedup

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type seenEntry struct {
	URL       string `json:"url"`
	Timestamp int64  `json:"timestamp"`
}

type JobCache struct {
	mu       sync.Mutex
	filePath string
	seen     map[string]int64
}

const thirtyDaysMs = int64(30 * 24 * 60 * 60 * 1000)

// NewJobCache creates or loads a job cache
func NewJobCache(cacheDir string) *JobCache {
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		log.Printf("⚠️ Failed to create cache directory: %v", err)
	}
	filepath := filepath.Join(cacheDir, "seen_jobs.json")
	cache := &JobCache{
		filePath: filepath,
		seen:     make(map[string]int64),
	}
	cache.load()
	return cache
}

// IsSeen checks if a URL has already been processed
// Mutex is required because Go maps are NOT thread-safe (see LEARNING-04.md)
func (jc *JobCache) IsSeen(url string) bool {
	jc.mu.Lock()
	defer jc.mu.Unlock()
	_, exists := jc.seen[url]
	return exists
}

func (jc *JobCache) Add(urls []string) {
	jc.mu.Lock()
	defer jc.mu.Unlock()

	now := time.Now().UnixMilli()
	changed := false
	for _, url := range urls {
		if _, exists := jc.seen[url]; !exists {
			jc.seen[url] = now
			changed = true
		}
	}

	if changed {
		jc.save()
	}
}

// load reads the cache from disk into the in-memory map
// (Why we populate seen here is explained in LEARNING-04.md)
func (jc *JobCache) load() {
	data, err := os.ReadFile(jc.filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("⚠️ Failed to read seen_jobs.json: %v", err)
		}
		return
	}

	var entries []seenEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		log.Printf("⚠️ Failed to parse seen_jobs.json: %v", err)
		return
	}

	thirtyDaysAgo := time.Now().UnixMilli() - thirtyDaysMs
	loaded := 0
	for _, e := range entries {
		if e.Timestamp > thirtyDaysAgo {
			jc.seen[e.URL] = e.Timestamp
			loaded++
		}
	}
	log.Printf("📋 Loaded %d previously seen jobs (%d expired and removed)", loaded, len(entries)-loaded)
}

// save writes the current cache to disk
func (jc *JobCache) save() {
	entries := make([]seenEntry, 0, len(jc.seen))
	for url, ts := range jc.seen {
		entries = append(entries, seenEntry{URL: url, Timestamp: ts})
	}
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		log.Printf("⚠️ Failed to marshal seen jobs: %v", err)
		return
	}
	if err := os.WriteFile(jc.filePath, data, 0644); err != nil {
		log.Printf("⚠️ Failed to write seen_jobs.json: %v", err)
	}
	log.Printf("💾 Saved %d seen jobs to cache", len(entries))
}
