package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
)

func main() {
	// 1. Tải biến môi trường (Load .env)
	if err := godotenv.Load(".env"); err != nil {
		godotenv.Load("../../.env") // Fallback
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL environment variable is not set. Please check your .env file.")
	}

	// Cảnh báo nếu bạn quên thay mật khẩu
	if dbURL == "postgresql://postgres:[YOUR-PASSWORD]@db.hremqjddnkfbihgvgygo.supabase.co:5432/postgres" {
		log.Fatal("⚠️ Bạn CHƯA ĐỔI MẬT KHẨU trong DATABASE_URL. Hãy đổi [YOUR-PASSWORD] thành mật khẩu của database Supabase!")
	}

	fmt.Println("Attempting to connect to PostgreSQL...")

	// Set a timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 2. Kết nối CSDL thông qua PGX
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		log.Fatalf("❌ Failed to connect to the database. Error: %v\n(Check your connection string, password, and Ensure you have internet access)", err)
	}
	defer conn.Close(context.Background())

	// 3. Truy vấn ví dụ để test
	var version string
	if err := conn.QueryRow(context.Background(), "SELECT version()").Scan(&version); err != nil {
		log.Fatalf("❌ Query failed: %v", err)
	}

	// Test lấy database size
	var dbSize string
	if err := conn.QueryRow(context.Background(), "SELECT pg_size_pretty(pg_database_size(current_database()))").Scan(&dbSize); err == nil {
		fmt.Printf("📦 Current Database Size: %s\n", dbSize)
	}

	fmt.Println("✅ Successfully connected to Supabase Database!")
	fmt.Println("🚀 Database Version:", version)
}
