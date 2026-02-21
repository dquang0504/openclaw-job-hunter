package database

import (
	"context"
	"fmt"
	"time"

	"go-openclaw-automation/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func ConnectDB(ctx context.Context, connString string) (*Repository, error) {
	config, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("unable to parse database url: %w", err)
	}

	config.MaxConns = 10
	config.MinConns = 2
	config.MaxConnLifetime = time.Hour

	// IMPORTANT: Supabase connection pooler (PgBouncer in Transaction mode)
	// does not support prepared statements easily. We MUST disable the statement cache.
	config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	// Ping to ensure connection
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("database unreachable: %w", err)
	}

	return &Repository{db: pool}, nil
}

func (r *Repository) Close() {
	if r.db != nil {
		r.db.Close()
	}
}

// ---------------- USER OPERATIONS ----------------

// GetOrCreateUser retrieves a user by their Telegram ID, or creates a placeholder if they don't exist
func (r *Repository) GetOrCreateUser(ctx context.Context, telegramID int64, username string, masterResume []byte) (*models.User, error) {
	var user models.User

	// Try to get user first
	err := r.db.QueryRow(ctx, "SELECT id, telegram_id, username, master_resume_json, created_at, updated_at FROM users WHERE telegram_id = $1", telegramID).
		Scan(&user.ID, &user.TelegramID, &user.Username, &user.MasterResumeJSON, &user.CreatedAt, &user.UpdatedAt)

	if err == pgx.ErrNoRows {
		// User doesn't exist, create them
		query := `
			INSERT INTO users (telegram_id, username, master_resume_json)
			VALUES ($1, $2, $3)
			RETURNING id, telegram_id, username, master_resume_json, created_at, updated_at`
		err = r.db.QueryRow(ctx, query, telegramID, username, string(masterResume)).
			Scan(&user.ID, &user.TelegramID, &user.Username, &user.MasterResumeJSON, &user.CreatedAt, &user.UpdatedAt)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to get or create user: %w", err)
	}

	return &user, nil
}

func (r *Repository) UpdateUserResume(ctx context.Context, userID string, masterResume []byte) error {
	_, err := r.db.Exec(ctx, "UPDATE users SET master_resume_json = $1 WHERE id = $2", masterResume, userID)
	if err != nil {
		return fmt.Errorf("failed to update user resume: %w", err)
	}
	return nil
}

// ---------------- JOB OPERATIONS ----------------

// SaveJob inserts a new job or updates an existing one (based on source + external_id)
func (r *Repository) SaveJob(ctx context.Context, job *models.Job) (*models.Job, error) {
	query := `
		INSERT INTO jobs (source, external_id, title, company, url, description_raw, description_summary)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (source, external_id) 
		DO UPDATE SET title = EXCLUDED.title, company = EXCLUDED.company, description_raw = EXCLUDED.description_raw
		RETURNING id, source, external_id, title, company, url, description_raw, description_summary, created_at`

	err := r.db.QueryRow(ctx, query, job.Source, job.ExternalID, job.Title, job.Company, job.URL, job.DescriptionRaw, job.DescriptionSummary).
		Scan(&job.ID, &job.Source, &job.ExternalID, &job.Title, &job.Company, &job.URL, &job.DescriptionRaw, &job.DescriptionSummary, &job.CreatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to save job: %w", err)
	}

	return job, nil
}

// GetJobByID retrieves a job by testing ID
func (r *Repository) GetJobByID(ctx context.Context, jobID string) (*models.Job, error) {
	var job models.Job
	query := `SELECT id, source, external_id, title, company, url, description_raw, description_summary, created_at FROM jobs WHERE id = $1`
	err := r.db.QueryRow(ctx, query, jobID).
		Scan(&job.ID, &job.Source, &job.ExternalID, &job.Title, &job.Company, &job.URL, &job.DescriptionRaw, &job.DescriptionSummary, &job.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("job not found")
		}
		return nil, fmt.Errorf("failed to get job by ID: %w", err)
	}
	return &job, nil
}

// ---------------- APPLICATION OPERATIONS ----------------

// InsertApplication creates a new tracked application state (SCANNED by default)
func (r *Repository) UpsertApplication(ctx context.Context, app *models.Application) (*models.Application, error) {
	query := `
		INSERT INTO applications (user_id, job_id, status)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, job_id) 
		DO UPDATE SET status = EXCLUDED.status
		RETURNING id, user_id, job_id, status, tailored_resume_json, match_score, cover_letter, created_at, updated_at`

	err := r.db.QueryRow(ctx, query, app.UserID, app.JobID, app.Status).
		Scan(&app.ID, &app.UserID, &app.JobID, &app.Status, &app.TailoredResumeJSON, &app.MatchScore, &app.CoverLetter, &app.CreatedAt, &app.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to upsert application: %w", err)
	}
	return app, nil
}

// UpdateApplicationStatus changes the application state
func (r *Repository) UpdateApplicationStatus(ctx context.Context, appID string, status models.ApplicationStatus) error {
	_, err := r.db.Exec(ctx, "UPDATE applications SET status = $1 WHERE id = $2", status, appID)
	return err
}

// UpdateApplicationResult saves the AI tailored resume and marks as COMPLETE
func (r *Repository) UpdateApplicationResult(ctx context.Context, appID string, tailoredResume []byte, status models.ApplicationStatus) error {
	_, err := r.db.Exec(ctx, "UPDATE applications SET tailored_resume_json = $1, status = $2 WHERE id = $3",
		string(tailoredResume), status, appID)
	return err
}
