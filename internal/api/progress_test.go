package api

import (
	"testing"

	"github.com/rapando/gopolice/internal/scanner"
)

func TestScanLogReplayAndSequence(t *testing.T) {
	l := newScanLog()
	l.emit(scanner.ProgressEvent{Scanner: "pipeline", Status: scanner.StatusStarted, Message: "Starting scan"})
	l.emit(scanner.ProgressEvent{Scanner: "tests", Status: scanner.StatusRunning, Done: 1, Total: 5})

	recorded, ch := l.attach()
	defer l.detach(ch)
	if len(recorded) != 2 || recorded[0].Seq != 1 || recorded[1].Seq != 2 {
		t.Fatalf("recorded = %+v", recorded)
	}

	l.emit(scanner.ProgressEvent{Scanner: "tests", Status: scanner.StatusCompleted, Message: "done"})
	select {
	case ev := <-ch:
		if ev.Seq != 3 || ev.Status != scanner.StatusCompleted {
			t.Errorf("live event = %+v", ev)
		}
	default:
		t.Fatal("live event not delivered")
	}

	// A new scan starts from an empty log but keeps numbering upward, so a
	// client holding old sequence numbers never mistakes new events for old.
	l.reset()
	l.emit(scanner.ProgressEvent{Scanner: "pipeline", Status: scanner.StatusStarted})
	if snap := l.snapshot(); len(snap) != 1 || snap[0].Seq != 4 {
		t.Errorf("after reset: %+v", snap)
	}
}

func TestScanLogCompactsTicksOnly(t *testing.T) {
	l := newScanLog()
	l.emit(scanner.ProgressEvent{Scanner: "pipeline", Status: scanner.StatusStarted, Message: "start"})
	for i := 0; i < maxLogEvents+50; i++ {
		l.emit(scanner.ProgressEvent{Scanner: "tests", Status: scanner.StatusRunning, Done: i, Total: 100000})
	}
	l.emit(scanner.ProgressEvent{Scanner: "tests", Status: scanner.StatusCompleted, Message: "done"})

	snap := l.snapshot()
	if len(snap) > maxLogEvents {
		t.Errorf("log grew to %d events", len(snap))
	}
	if snap[0].Message != "start" || snap[len(snap)-1].Message != "done" {
		t.Errorf("lifecycle events lost: first=%+v last=%+v", snap[0], snap[len(snap)-1])
	}
	ticks := 0
	for _, ev := range snap {
		if ev.IsTick() {
			ticks++
		}
	}
	if ticks < keepTicks {
		t.Errorf("only %d ticks kept, want at least %d", ticks, keepTicks)
	}
	// The most recent ticks are the ones kept.
	if last := snap[len(snap)-2]; last.Done != maxLogEvents+49 {
		t.Errorf("last tick = %+v", last)
	}
}
