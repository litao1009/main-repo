package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"clawstudios/pkg/logging"
	"session_manager/api"
	"session_manager/manager"
)

func main() {
	port := flag.Int("port", 18080, "HTTP server port")
	dataDir := flag.String("data-dir", "/tmp/session_manager", "Data directory")
	opencodeBin := flag.String("opencode", "opencode", "Path to opencode binary")
	model := flag.String("model", "deepseek/deepseek-chat", "Default model")
	maxConcurrent := flag.Int("max-concurrent", 3, "Max concurrent opencode processes")
	defaultTimeoutSec := flag.Int("default-timeout-sec", 600, "Default timeout in seconds for each opencode attempt")
	staleTimeoutMin := flag.Int("stale-timeout-min", 60, "Stale session timeout in minutes")
	zombieTimeoutMin := flag.Int("zombie-timeout-min", 30, "Timeout in minutes for zombie sessions (GENERATING with zero output)")
	deepseekAPIKey := flag.String("deepseek-api-key", "", "Optional override for DeepSeek API key (default: read from OPENCODE_CONFIG provider section)")
	skillRegistry := flag.String("skill-registry", "http://localhost:18090", "Skill Registry URL")
	flag.Parse()

	debugLogs := os.Getenv("SM_DEBUG_LOGS") == "true"

	cfg := manager.Config{
		DataDir:                 *dataDir,
		OpenCodeBinary:          *opencodeBin,
		DefaultModel:            *model,
		MaxConcurrent:           *maxConcurrent,
		DefaultTimeoutSec:       *defaultTimeoutSec,
		MaxMessagesPerEpoch:     40,
		MaxTokensPerEpoch:       60000,
		StaleTimeoutMin:         *staleTimeoutMin,
		ZombieSessionTimeoutMin: *zombieTimeoutMin,
		DeepseekAPIKey:          *deepseekAPIKey,
		SkillRegistryURL:        *skillRegistry,
		Debug:                   debugLogs,
	}

	sm, err := manager.New(cfg)
	if err != nil {
		log.Fatalf("Failed to init session manager: %v", err)
	}

	log.Printf("Session Manager starting")
	log.Printf("  Data dir:       %s", cfg.DataDir)
	log.Printf("  OpenCode:       %s", cfg.OpenCodeBinary)
	log.Printf("  Model:          %s", cfg.DefaultModel)
	log.Printf("  Max workers:    %d", cfg.MaxConcurrent)
	log.Printf("  Timeout:        %d sec", cfg.DefaultTimeoutSec)
	log.Printf("  Stale timeout:  %d min", cfg.StaleTimeoutMin)
	log.Printf("  Zombie timeout: %d min", cfg.ZombieSessionTimeoutMin)
	log.Printf("  Debug logs:     %v", cfg.Debug)
	log.Printf("  API port:       %d", *port)

	server := api.NewServer(sm)

	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", *port),
		Handler: logging.HTTPMiddleware("SessionManager")(corsMiddleware(server.Router())),
	}

	go func() {
		log.Printf("HTTP server listening on :%d", *port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("Received signal %v, shutting down...", sig)

	sm.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}

	log.Println("Session Manager stopped")
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
