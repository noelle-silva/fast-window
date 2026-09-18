package main

import (
	"errors"
	"strings"
)

const boxConnectionSourceManual = "manual"

type boxConnection struct {
	Source     string
	BaseURL    string
	Credential string
}

func (connection *boxConnection) valid() bool {
	return connection != nil &&
		connection.Source == boxConnectionSourceManual &&
		strings.TrimSpace(connection.BaseURL) != ""
}

func (s *service) currentBoxConnection() (*boxConnection, error) {
	cfg, err := s.config.load()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.EucliBoxURL) == "" {
		return nil, errors.New("EUCLI_BOX_NOT_CONFIGURED")
	}
	return &boxConnection{Source: boxConnectionSourceManual, BaseURL: cfg.EucliBoxURL, Credential: cfg.EucliBoxKey}, nil
}
