package main

import (
	"eucli-studio-backend/internal/ebcontract"
)

func testClientRelease() clientRelease {
	return clientRelease{
		Version: "0.1.9",
		EucliBoxCompatibility: ebcontract.EucliBoxCompatibility{
			MinimumVersion:          "0.1.0",
			MaximumVersionExclusive: "0.2.0",
		},
	}
}

func newBusinessReadyTestService(config *configStore, hub *eventHub) *service {
	svc, err := newService(config, testClientRelease(), hub)
	if err != nil {
		panic(err)
	}
	svc.setConnectionState(runtimeBootstrap{BusinessAvailable: true})
	return svc
}
