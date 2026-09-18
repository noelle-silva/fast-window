package main

import (
	"sync"

	"github.com/gorilla/websocket"
)

type directConnection struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

func newDirectConnection(conn *websocket.Conn) *directConnection {
	return &directConnection{conn: conn}
}

func (c *directConnection) readJSON(value any) error {
	return c.conn.ReadJSON(value)
}

func (c *directConnection) writeJSON(value any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteJSON(value)
}

func (c *directConnection) close() error {
	return c.conn.Close()
}
