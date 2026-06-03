package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const (
	setupModeGlobal = "global"
)

type setupState struct {
	SchemaVersion  int    `json:"schemaVersion"`
	Mode           string `json:"mode"`
	InstanceName   string `json:"instanceName"`
	ServiceName    string `json:"serviceName"`
	RuntimeVersion string `json:"runtimeVersion"`
	RuntimeSHA256  string `json:"runtimeSha256"`
	EnabledAt      string `json:"enabledAt,omitempty"`
	UpdatedAt      string `json:"updatedAt"`
}

type setupInfo struct {
	Configured      bool       `json:"configured"`
	State           setupState `json:"state"`
	AvailableModes  []string   `json:"availableModes"`
	RequiresConsent []string   `json:"requiresConsent"`
}

func (svc *service) setupInfoLocked() (setupInfo, error) {
	state, configured, err := svc.readSetupStateWithFlagLocked()
	if err != nil {
		return setupInfo{}, err
	}
	serviceConfigured, err := svc.globalServiceConfiguredLocked()
	if err != nil {
		return setupInfo{}, err
	}
	if serviceConfigured && !configured {
		if err := svc.attachRuntimeFingerprintLocked(&state); err != nil {
			return setupInfo{}, err
		}
	}
	return setupInfo{
		Configured:      configured || serviceConfigured,
		State:           state,
		AvailableModes:  []string{setupModeGlobal},
		RequiresConsent: []string{setupModeGlobal},
	}, nil
}

func (svc *service) readSetupStateLocked() (setupState, error) {
	state, _, err := svc.readSetupStateWithFlagLocked()
	return state, err
}

func (svc *service) readSetupStateWithFlagLocked() (setupState, bool, error) {
	state := svc.defaultSetupState()
	path := svc.setupPath()
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return state, false, nil
	}
	if err := readJSON(path, &state); err != nil {
		return setupState{}, false, fmt.Errorf("read Everything setup failed: %w", err)
	}
	if err := svc.normalizeSetupState(&state); err != nil {
		return setupState{}, false, err
	}
	return state, true, nil
}

func (svc *service) enableGlobalSetupLocked() (setupInfo, error) {
	if err := svc.installOrValidateGlobalServiceLocked(); err != nil {
		return setupInfo{}, err
	}
	state := svc.defaultSetupState()
	state.EnabledAt = nowText()
	state.UpdatedAt = nowText()
	if err := svc.attachRuntimeFingerprintLocked(&state); err != nil {
		return setupInfo{}, err
	}
	if err := writeJSON(svc.setupPath(), state); err != nil {
		return setupInfo{}, err
	}
	if err := svc.restartRuntimeOnlyLocked(); err != nil {
		return setupInfo{}, err
	}
	return svc.setupInfoLocked()
}

func (svc *service) setupPath() string {
	return filepath.Join(svc.dataDir, svc.identity.SetupFile)
}

func (svc *service) defaultSetupState() setupState {
	now := nowText()
	return setupState{
		SchemaVersion: 1,
		Mode:          setupModeGlobal,
		InstanceName:  svc.identity.InstanceName,
		ServiceName:   svc.identity.ServiceName,
		UpdatedAt:     now,
	}
}

func (svc *service) normalizeSetupState(state *setupState) error {
	if state.SchemaVersion != 1 {
		return fmt.Errorf("Everything setup schemaVersion must be 1")
	}
	if state.InstanceName != svc.identity.InstanceName {
		return fmt.Errorf("Everything setup instanceName mismatch")
	}
	if state.ServiceName == "" {
		state.ServiceName = svc.identity.ServiceName
	}
	if state.ServiceName != svc.identity.ServiceName {
		return fmt.Errorf("Everything setup serviceName mismatch")
	}
	switch state.Mode {
	case setupModeGlobal:
	default:
		return fmt.Errorf("Everything setup mode unsupported: %s", state.Mode)
	}
	return nil
}

func (svc *service) attachRuntimeFingerprintLocked(state *setupState) error {
	manifest, err := svc.validateVendorLocked()
	if err != nil {
		return err
	}
	hash, err := sha256File(svc.vendorEverythingExePath())
	if err != nil {
		return err
	}
	state.RuntimeVersion = manifest.RuntimeVersion
	state.RuntimeSHA256 = hash
	return nil
}
