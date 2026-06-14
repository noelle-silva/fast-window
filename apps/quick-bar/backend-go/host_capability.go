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

func (svc *service) listHostCapabilities() (any, error) {
	client, err := newHostCapabilityClientFromEnv()
	if err != nil {
		return nil, err
	}
	return client.get("/capabilities")
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
