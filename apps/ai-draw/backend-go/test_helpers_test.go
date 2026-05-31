package main

import "sync"

const testPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
const testPNGDataURL = "data:image/png;base64," + testPNGBase64

type recordingSink struct {
	mu     sync.Mutex
	events []eventFrame
}

func (sink *recordingSink) Broadcast(event eventFrame) {
	sink.mu.Lock()
	defer sink.mu.Unlock()
	sink.events = append(sink.events, event)
}

func (sink *recordingSink) count() int {
	sink.mu.Lock()
	defer sink.mu.Unlock()
	return len(sink.events)
}
