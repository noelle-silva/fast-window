package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func runOpenAIRequest(ctx context.Context, req aiHTTPRequest, stream bool, onDelta func(delta string)) (string, error) {
	req = normalizeHTTPRequest(req)
	if strings.TrimSpace(req.URL) == "" {
		return "", errors.New("request url is required")
	}
	timeoutMs := req.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 120000
	}
	client := &http.Client{Timeout: time.Duration(timeoutMs+5000) * time.Millisecond}
	bodyReader := bytes.NewReader([]byte(req.Body))
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, req.URL, bodyReader)
	if err != nil {
		return "", err
	}
	for key, value := range req.Headers {
		if strings.TrimSpace(key) != "" {
			httpReq.Header.Set(key, value)
		}
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
		return "", errors.New(extractErrorMessage(string(payload), resp.StatusCode))
	}

	if stream {
		return readOpenAIStream(ctx, resp.Body, onDelta)
	}
	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return extractOpenAIText(payload)
}

func (svc *service) netRequest(params json.RawMessage) (map[string]any, error) {
	var req aiHTTPRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, err
	}
	req = normalizeHTTPRequest(req)
	if strings.TrimSpace(req.URL) == "" {
		return nil, errors.New("request url is required")
	}
	timeoutMs := req.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 30000
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	bodyReader := bytes.NewReader([]byte(req.Body))
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, req.URL, bodyReader)
	if err != nil {
		return nil, err
	}
	for key, value := range req.Headers {
		if strings.TrimSpace(key) != "" {
			httpReq.Header.Set(key, value)
		}
	}
	client := &http.Client{Timeout: time.Duration(timeoutMs+1000) * time.Millisecond}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 32*1024*1024))
	if err != nil {
		return nil, err
	}
	return map[string]any{"status": resp.StatusCode, "body": string(payload)}, nil
}

func readOpenAIStream(ctx context.Context, body io.Reader, onDelta func(delta string)) (string, error) {
	reader := bufio.NewReader(body)
	state := &sseState{}
	out := strings.Builder{}
	for {
		select {
		case <-ctx.Done():
			return out.String(), ctx.Err()
		default:
		}
		line, err := reader.ReadString('\n')
		if line != "" {
			done, feedErr := sseFeedGo(state, line, func(jsonValue map[string]any) error {
				if errObj := asMap(jsonValue["error"]); errObj != nil {
					return errors.New(asString(errObj["message"]))
				}
				delta := extractOpenAIDeltaGo(jsonValue)
				if delta != "" {
					out.WriteString(delta)
					if onDelta != nil {
						onDelta(delta)
					}
				}
				return nil
			})
			if feedErr != nil {
				return out.String(), feedErr
			}
			if done {
				return out.String(), nil
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				_, feedErr := sseFeedGo(state, "\n\n", func(jsonValue map[string]any) error {
					delta := extractOpenAIDeltaGo(jsonValue)
					if delta != "" {
						out.WriteString(delta)
						if onDelta != nil {
							onDelta(delta)
						}
					}
					return nil
				})
				return out.String(), feedErr
			}
			return out.String(), err
		}
	}
}

func extractOpenAIText(payload []byte) (string, error) {
	var jsonValue map[string]any
	if err := json.Unmarshal(payload, &jsonValue); err != nil {
		return "", err
	}
	if errObj := asMap(jsonValue["error"]); errObj != nil {
		return "", errors.New(asString(errObj["message"]))
	}
	choices := asSlice(jsonValue["choices"])
	if len(choices) > 0 {
		choice := asMap(choices[0])
		message := asMap(choice["message"])
		if content := asString(message["content"]); content != "" {
			return content, nil
		}
		if text := asString(choice["text"]); text != "" {
			return text, nil
		}
	}
	return asString(jsonValue["output_text"]), nil
}

func extractErrorMessage(body string, status int) string {
	var jsonValue map[string]any
	if err := json.Unmarshal([]byte(body), &jsonValue); err == nil {
		if errObj := asMap(jsonValue["error"]); errObj != nil {
			msg := strings.TrimSpace(asString(errObj["message"]))
			if msg != "" {
				return msg
			}
		}
	}
	body = strings.TrimSpace(body)
	if body != "" {
		return body
	}
	return fmt.Sprintf("HTTP %d", status)
}
