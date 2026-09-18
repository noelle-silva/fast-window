package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"eucli-studio-backend/internal/ebcontract"
)

const clientReleaseEnvironment = "EUCLI_STUDIO_RELEASE_JSON"

type clientRelease struct {
	Version               string                      `json:"version"`
	EucliBoxCompatibility ebcontract.EucliBoxCompatibility `json:"eucliBoxCompatibility"`
}

func loadClientRelease(source string) (clientRelease, error) {
	var info clientRelease
	decoder := json.NewDecoder(strings.NewReader(source))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&info); err != nil {
		return clientRelease{}, fmt.Errorf("读取 eucli-studio 发布资料失败：%w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return clientRelease{}, fmt.Errorf("读取 eucli-studio 发布资料失败：存在多余内容")
	}
	info.Version = strings.TrimSpace(info.Version)
	info.EucliBoxCompatibility.MinimumVersion = strings.TrimSpace(info.EucliBoxCompatibility.MinimumVersion)
	info.EucliBoxCompatibility.MaximumVersionExclusive = strings.TrimSpace(info.EucliBoxCompatibility.MaximumVersionExclusive)
	if err := ebcontract.ValidateVersion(info.Version); err != nil {
		return clientRelease{}, fmt.Errorf("eucli-studio 版本无效：%w", err)
	}
	if err := ebcontract.ValidateEucliBoxCompatibility(info.EucliBoxCompatibility); err != nil {
		return clientRelease{}, fmt.Errorf("eucli-studio 适用范围无效：%w", err)
	}
	return info, nil
}

func (r clientRelease) applyHeaders(header http.Header) {
	header.Set("X-Eucli-Studio-Version", r.Version)
	header.Set("X-Eucli-Studio-Minimum-Box-Version", r.EucliBoxCompatibility.MinimumVersion)
	header.Set("X-Eucli-Studio-Maximum-Box-Version", r.EucliBoxCompatibility.MaximumVersionExclusive)
}
