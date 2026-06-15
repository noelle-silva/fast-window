package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const hostCapabilityRequestTimeout = 30 * time.Second

type hostCapabilityListParams struct {
	AppID        string `json:"appId"`
	LaunchPolicy string `json:"launchPolicy"`
}

type hostCapabilityClient struct {
	baseURL string
	token   string
	http    *http.Client
}

func newHostCapabilityClientFromEnv() (*hostCapabilityClient, error) {
	baseURL := strings.TrimSpace(os.Getenv("FW_HOST_CAPABILITY_URL"))
	if baseURL == "" {
		return nil, errors.New("environment variable FW_HOST_CAPABILITY_URL is required")
	}
	token := strings.TrimSpace(os.Getenv("FW_HOST_CAPABILITY_TOKEN"))
	if token == "" {
		return nil, errors.New("environment variable FW_HOST_CAPABILITY_TOKEN is required")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid FW_HOST_CAPABILITY_URL: %s", baseURL)
	}
	return &hostCapabilityClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: hostCapabilityRequestTimeout},
	}, nil
}

func (client *hostCapabilityClient) get(path string) (any, error) {
	return client.request(http.MethodGet, path, nil)
}

func (client *hostCapabilityClient) post(path string, body any) (any, error) {
	return client.request(http.MethodPost, path, body)
}

func (client *hostCapabilityClient) request(method string, path string, body any) (any, error) {
	requestBody, err := encodeHostCapabilityRequestBody(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(method, client.baseURL+path, requestBody)
	if err != nil {
		return nil, fmt.Errorf("create host capability request failed: %w", err)
	}
	req.Header.Set("X-FW-Control-Token", client.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("host capability request failed: %w", err)
	}
	defer resp.Body.Close()

	responseBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read host capability response failed: %w", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("host capability service returned %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBytes)))
	}
	if len(bytes.TrimSpace(responseBytes)) == 0 {
		return map[string]any{}, nil
	}

	var result any
	if err := json.Unmarshal(responseBytes, &result); err != nil {
		return nil, fmt.Errorf("decode host capability response failed: %w", err)
	}
	return result, nil
}

func encodeHostCapabilityRequestBody(body any) (io.Reader, error) {
	if body == nil {
		return nil, nil
	}
	bytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encode host capability request failed: %w", err)
	}
	return strings.NewReader(string(bytes)), nil
}

func (svc *service) listHostCapabilities(params json.RawMessage) (any, error) {
	request, err := decodeHostCapabilityListParams(params)
	if err != nil {
		return nil, err
	}
	client, err := newHostCapabilityClientFromEnv()
	if err != nil {
		return nil, err
	}
	path := hostCapabilityListPath(request)
	return client.get(path)
}

func decodeHostCapabilityListParams(params json.RawMessage) (hostCapabilityListParams, error) {
	if len(params) == 0 || string(params) == "null" {
		return hostCapabilityListParams{}, nil
	}
	var request hostCapabilityListParams
	if err := json.Unmarshal(params, &request); err != nil {
		return hostCapabilityListParams{}, fmt.Errorf("decode host capability list params failed: %w", err)
	}
	request.AppID = strings.TrimSpace(request.AppID)
	request.LaunchPolicy = strings.TrimSpace(request.LaunchPolicy)
	if request.LaunchPolicy == "" {
		request.LaunchPolicy = "runningOnly"
	}
	if request.LaunchPolicy != "runningOnly" && request.LaunchPolicy != "allowLaunch" {
		return hostCapabilityListParams{}, fmt.Errorf("invalid launchPolicy: %s", request.LaunchPolicy)
	}
	return request, nil
}

func hostCapabilityListPath(request hostCapabilityListParams) string {
	query := url.Values{}
	query.Set("launchPolicy", request.LaunchPolicy)
	if request.AppID != "" {
		query.Set("appId", request.AppID)
	}
	return "/capabilities?" + query.Encode()
}

func (svc *service) invokeHostCapability(params json.RawMessage) (any, error) {
	request, err := decodeHostCapabilityParams(params)
	if err != nil {
		return nil, err
	}
	client, err := newHostCapabilityClientFromEnv()
	if err != nil {
		return nil, err
	}
	return client.post("/capability/invoke", request)
}

func (svc *service) queryHostCapabilityOptions(params json.RawMessage) (any, error) {
	request, err := decodeHostCapabilityParams(params)
	if err != nil {
		return nil, err
	}
	client, err := newHostCapabilityClientFromEnv()
	if err != nil {
		return nil, err
	}
	return client.post("/capability/query-options", request)
}

func decodeHostCapabilityParams(params json.RawMessage) (map[string]any, error) {
	if len(params) == 0 || string(params) == "null" {
		return nil, errors.New("host capability params are required")
	}
	var request map[string]any
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode host capability params failed: %w", err)
	}
	return request, nil
}
