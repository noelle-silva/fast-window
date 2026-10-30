package main

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// 响应帧队列：满即关连接（响应丢了就悬挂，连接已不可信）。
	responseQueueCapacity = 64
	// 事件帧队列：提示性语义，满时丢弃最旧的非终态事件。
	eventQueueMaxItems = 256
	eventQueueMaxBytes = 8 << 20
	// 单帧写超时：慢客户端不允许无限期占住 writer。
	writeDeadline = 10 * time.Second
)

var errResponseQueueFull = errors.New("direct connection response queue is full")

type queuedEvent struct {
	frame    []byte
	terminal bool
}

// eventQueue 是单个订阅者的事件缓冲。
//
// 策略（design-5 决策 3）：事件帧满时丢弃最旧 / 合并；
// 但终态事件永远不因背压被丢弃——前端靠终态收尾，丢了会让 run 卡在 running。
type eventQueue struct {
	mu    sync.Mutex
	items []queuedEvent
	bytes int
}

func (q *eventQueue) push(frame []byte, terminal bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for q.overLimitLocked(len(frame)) {
		if !q.dropOldestNonTerminalLocked() {
			break
		}
	}
	if q.overLimitLocked(len(frame)) {
		if !terminal {
			// 提示性事件：宁可丢弃也不挤掉终态。
			return
		}
		// 队列全是终态且已超限：8MB 上限是硬约束，不能因为「终态珍贵」而无界增长。
		// 丢掉最旧的一条终态——它对应的 run 已经结束，前端重连后仍可通过 RunProbe
		// 探到权威终态（终态在服务端保留 10 分钟）。
		if !q.dropOldestTerminalLocked() {
			return
		}
	}
	q.items = append(q.items, queuedEvent{frame: frame, terminal: terminal})
	q.bytes += len(frame)
}

func (q *eventQueue) pop() ([]byte, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) == 0 {
		return nil, false
	}
	item := q.items[0]
	q.items = q.items[1:]
	q.bytes -= len(item.frame)
	return item.frame, true
}

func (q *eventQueue) overLimitLocked(incoming int) bool {
	return len(q.items) >= eventQueueMaxItems || q.bytes+incoming > eventQueueMaxBytes
}

func (q *eventQueue) dropOldestNonTerminalLocked() bool {
	for index, item := range q.items {
		if item.terminal {
			continue
		}
		q.items = append(q.items[:index], q.items[index+1:]...)
		q.bytes -= len(item.frame)
		return true
	}
	return false
}

func (q *eventQueue) dropOldestTerminalLocked() bool {
	if len(q.items) == 0 {
		return false
	}
	item := q.items[0]
	q.items = q.items[1:]
	q.bytes -= len(item.frame)
	return true
}

type directConnection struct {
	conn    *websocket.Conn
	writeMu sync.Mutex

	responses   chan []byte
	events      *eventQueue
	eventSignal chan struct{}

	writerOnce sync.Once
	done       chan struct{}
	closeOnce  sync.Once

	cancelMu sync.Mutex
	cancels  map[string]context.CancelFunc
}

func newDirectConnection(conn *websocket.Conn) *directConnection {
	return &directConnection{
		conn:        conn,
		responses:   make(chan []byte, responseQueueCapacity),
		events:      &eventQueue{},
		eventSignal: make(chan struct{}, 1),
		done:        make(chan struct{}),
		cancels:     map[string]context.CancelFunc{},
	}
}

func (c *directConnection) readJSON(value any) error {
	return c.conn.ReadJSON(value)
}

// writeFrame 是所有出站帧的唯一落点：一次 WriteMessage、一把锁、一次写超时。
func (c *directConnection) writeFrame(payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeDeadline))
	return c.conn.WriteMessage(websocket.TextMessage, payload)
}

// enqueueResponse 把响应帧交给唯一的 writer。
// 队列满意味着客户端已经读不动：直接关连接，绝不让响应悬挂。
func (c *directConnection) enqueueResponse(frame []byte) error {
	c.startWriter()
	select {
	case <-c.done:
		return errors.New("direct connection closed")
	case c.responses <- frame:
		return nil
	default:
		_ = c.close()
		return errResponseQueueFull
	}
}

// enqueueEvent 把事件帧放进有界缓冲：满了按策略丢弃/合并。
func (c *directConnection) enqueueEvent(frame []byte, terminal bool) {
	c.startWriter()
	c.events.push(frame, terminal)
	select {
	case c.eventSignal <- struct{}{}:
	default:
	}
}

func (c *directConnection) startWriter() {
	c.writerOnce.Do(func() {
		go c.writeLoop()
	})
}

// writeLoop 是每个连接唯一的写者。
//
// 每一轮先把响应队列排空，再发一条事件：事件洪峰不允许饿死响应。
func (c *directConnection) writeLoop() {
	for {
		// 响应优先。
		drained := false
		for {
			select {
			case <-c.done:
				return
			case frame := <-c.responses:
				if err := c.writeFrame(frame); err != nil {
					_ = c.close()
					return
				}
				drained = true
				continue
			default:
			}
			break
		}

		if frame, ok := c.events.pop(); ok {
			if err := c.writeFrame(frame); err != nil {
				_ = c.close()
				return
			}
			continue
		}
		if drained {
			continue
		}

		select {
		case <-c.done:
			return
		case frame := <-c.responses:
			if err := c.writeFrame(frame); err != nil {
				_ = c.close()
				return
			}
		case <-c.eventSignal:
		}
	}
}

func (c *directConnection) registerCancel(id string, cancel context.CancelFunc) {
	c.cancelMu.Lock()
	c.cancels[id] = cancel
	c.cancelMu.Unlock()
}

func (c *directConnection) unregisterCancel(id string) {
	c.cancelMu.Lock()
	delete(c.cancels, id)
	c.cancelMu.Unlock()
}

// cancelRequest 只取消「等待」这一个平面：工作是否停止由业务端决定。
func (c *directConnection) cancelRequest(id string) {
	c.cancelMu.Lock()
	cancel := c.cancels[id]
	c.cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (c *directConnection) close() error {
	c.closeOnce.Do(func() {
		close(c.done)
		c.cancelMu.Lock()
		for id, cancel := range c.cancels {
			cancel()
			delete(c.cancels, id)
		}
		c.cancelMu.Unlock()
	})
	return c.conn.Close()
}

// encodeResultFrame 用字节拼接构造成功响应帧：
// 帧头 + 业务端原始字节 + 帧尾，业务载荷在 Go 侧不进入任何对象图。
func encodeResultFrame(id string, payload json.RawMessage) []byte {
	frame := make([]byte, 0, len(id)+len(payload)+48)
	frame = append(frame, `{"id":`...)
	frame = appendJSONString(frame, id)
	frame = append(frame, `,"type":"response","ok":true,"result":`...)
	if len(payload) == 0 {
		frame = append(frame, "null"...)
	} else {
		frame = append(frame, payload...)
	}
	frame = append(frame, '}')
	return frame
}

// encodeEventFrame 用字节拼接构造事件帧。
func encodeEventFrame(name string, payload json.RawMessage) []byte {
	frame := make([]byte, 0, len(name)+len(payload)+48)
	frame = append(frame, `{"type":"event","name":`...)
	frame = appendJSONString(frame, name)
	if len(payload) > 0 {
		frame = append(frame, `,"payload":`...)
		frame = append(frame, payload...)
	}
	frame = append(frame, '}')
	return frame
}

// writeResultRaw 发出已编码的成功响应帧（一次 WriteMessage）。
func (c *directConnection) writeResultRaw(id string, payload json.RawMessage) error {
	return c.writeFrame(encodeResultFrame(id, payload))
}

// appendJSONString 以标准 JSON 转义追加一个字符串（等价于 json.Marshal 的字符串结果）。
func appendJSONString(dst []byte, value string) []byte {
	encoded, err := json.Marshal(value)
	if err != nil {
		return append(dst, `""`...)
	}
	return append(dst, encoded...)
}
