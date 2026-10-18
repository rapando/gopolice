package api

import (
	"sync"

	"github.com/rapando/gopolice/internal/scanner"
)

// maxLogEvents bounds the per-scan event log. Lifecycle events are always
// kept; when the log fills, the oldest ticks are dropped.
const maxLogEvents = 2000

// keepTicks is how many recent ticks survive a compaction.
const keepTicks = 200

// scanLog records the events of the current scan and fans them out live.
// A client that connects mid-scan (or reloads the page) receives the recorded
// events first, so it sees the full picture rather than only what happens
// next. Events are numbered so a replay can be de-duplicated.
type scanLog struct {
	mu     sync.Mutex
	events []scanner.ProgressEvent
	seq    int
	b      *SSEBroadcaster
}

func newScanLog() *scanLog {
	return &scanLog{b: NewSSEBroadcaster()}
}

// reset forgets the previous scan; call it when a new one starts.
func (l *scanLog) reset() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.events = nil
}

// emit records the event and broadcasts it to live subscribers.
func (l *scanLog) emit(ev scanner.ProgressEvent) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.seq++
	ev.Seq = l.seq
	if len(l.events) >= maxLogEvents {
		l.compact()
	}
	l.events = append(l.events, ev)
	l.b.Broadcast(ev)
}

// compact drops old ticks, keeping every lifecycle event and the most recent
// ticks. Caller holds the lock.
func (l *scanLog) compact() {
	ticks := 0
	for _, ev := range l.events {
		if ev.IsTick() {
			ticks++
		}
	}
	drop := ticks - keepTicks
	if drop <= 0 {
		return
	}
	kept := l.events[:0]
	for _, ev := range l.events {
		if ev.IsTick() && drop > 0 {
			drop--
			continue
		}
		kept = append(kept, ev)
	}
	l.events = kept
}

// attach returns a copy of the recorded events and a channel for the ones
// that follow. Both happen under the lock, so nothing falls in the gap.
func (l *scanLog) attach() ([]scanner.ProgressEvent, chan scanner.ProgressEvent) {
	l.mu.Lock()
	defer l.mu.Unlock()
	snapshot := make([]scanner.ProgressEvent, len(l.events))
	copy(snapshot, l.events)
	return snapshot, l.b.Subscribe()
}

func (l *scanLog) detach(ch chan scanner.ProgressEvent) {
	l.b.Unsubscribe(ch)
}

// snapshot returns the recorded events of the current scan.
func (l *scanLog) snapshot() []scanner.ProgressEvent {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]scanner.ProgressEvent, len(l.events))
	copy(out, l.events)
	return out
}
