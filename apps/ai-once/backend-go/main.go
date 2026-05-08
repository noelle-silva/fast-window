package main

import "log"

func main() {
	svc, err := newService()
	if err != nil { log.Fatal(err) }
	if err := svc.ensureReady(); err != nil { log.Fatal(err) }
	if err := startRPC(svc); err != nil { log.Fatal(err) }
}
