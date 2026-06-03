package main

import (
	"fmt"
	"os"
	"strings"
)

const (
	channelDev               = "dev"
	channelRelease           = "release"
	everythingInstancePrefix = "fast-window-everything"
)

type appIdentity struct {
	Channel        string
	InstanceName   string
	ServiceName    string
	SetupFile      string
	RuntimeDirName string
}

func identityFromEnvironment() (appIdentity, error) {
	return identityForChannel(os.Getenv("FW_EVERYTHING_CHANNEL"))
}

func identityForChannel(value string) (appIdentity, error) {
	channel, err := normalizeIdentityChannel(value)
	if err != nil {
		return appIdentity{}, err
	}
	instanceName := fmt.Sprintf("%s-%s", everythingInstancePrefix, channel)
	return appIdentity{
		Channel:        channel,
		InstanceName:   instanceName,
		ServiceName:    fmt.Sprintf("Everything (%s)", instanceName),
		SetupFile:      fmt.Sprintf("everything-%s-global-setup.json", channel),
		RuntimeDirName: fmt.Sprintf("everything-runtime-%s", channel),
	}, nil
}

func normalizeIdentityChannel(value string) (string, error) {
	channel := strings.ToLower(strings.TrimSpace(value))
	if channel == "" {
		channel = channelRelease
	}
	switch channel {
	case channelDev, channelRelease:
		return channel, nil
	default:
		return "", fmt.Errorf("unsupported Everything channel: %s", value)
	}
}
