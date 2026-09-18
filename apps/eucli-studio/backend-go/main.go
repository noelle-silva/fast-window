package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
)

func main() {
	if err := run(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("fatal: %v", err)
		os.Exit(1)
	}
}

func run() error {
	token := strings.TrimSpace(os.Getenv("FW_APP_SESSION_TOKEN"))
	if token == "" {
		return errors.New("eucli-studio backend missing FW_APP_SESSION_TOKEN")
	}
	dataDir := strings.TrimSpace(os.Getenv("FW_APP_DATA_DIR"))
	release, err := loadClientRelease(os.Getenv(clientReleaseEnvironment))
	if err != nil {
		return err
	}
	store, err := newConfigStore(dataDir)
	if err != nil {
		return err
	}
	hub := newEventHub()
	svc, err := newService(store, release, hub)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go newEventBridge(svc, hub).run(ctx)
	return newDirectServer(token, svc, hub).listenAndServe(ctx)
}
