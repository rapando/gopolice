package api

import (
	"sync"

	"github.com/rapando/gopolice/internal/model"
	"github.com/rapando/gopolice/internal/scanner"
)

type Store struct {
	mu     sync.RWMutex
	result *model.ScanResult
}

func NewStore() *Store {
	return &Store{}
}

func (s *Store) Set(result *model.ScanResult) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.result = result
}

func (s *Store) Get() *model.ScanResult {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.result
}

func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.result = nil
}

type SSEBroadcaster struct {
	mu      sync.RWMutex
	clients map[chan scanner.ProgressEvent]struct{}
}

func NewSSEBroadcaster() *SSEBroadcaster {
	return &SSEBroadcaster{clients: make(map[chan scanner.ProgressEvent]struct{})}
}

func (b *SSEBroadcaster) Subscribe() chan scanner.ProgressEvent {
	b.mu.Lock()
	defer b.mu.Unlock()
	ch := make(chan scanner.ProgressEvent, 100)
	b.clients[ch] = struct{}{}
	return ch
}

func (b *SSEBroadcaster) Unsubscribe(ch chan scanner.ProgressEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.clients, ch)
	close(ch)
}

func (b *SSEBroadcaster) Broadcast(event scanner.ProgressEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.clients {
		select {
		case ch <- event:
		default:
		}
	}
}
