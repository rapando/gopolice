package scanner

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"
)

// tickInterval caps how often a scanner reports item-level progress so a
// project with thousands of tests does not flood the stream.
const tickInterval = 150 * time.Millisecond

// tracker reports one scanner's progress: lifecycle events (started,
// completed, failed) are always sent; ticks, which carry "N of M" counts and
// the item being worked on, are rate-limited.
type tracker struct {
	progress chan<- ProgressEvent
	scanner  string
	start    time.Time
	lastTick time.Time
}

func newTracker(progress chan<- ProgressEvent, scanner string) *tracker {
	return &tracker{progress: progress, scanner: scanner, start: time.Now()}
}

func (t *tracker) send(ev ProgressEvent) {
	if t.progress == nil {
		return
	}
	ev.Scanner = t.scanner
	t.progress <- ev
}

func (t *tracker) started(msg string) {
	t.send(ProgressEvent{Status: StatusStarted, Message: msg})
}

// step reports a sub-stage with its own message, e.g. "running gosec".
func (t *tracker) step(done, total int, unit, msg, detail string) {
	t.lastTick = time.Now()
	t.send(ProgressEvent{Status: StatusRunning, Message: msg, Done: done, Total: total, Unit: unit, Detail: detail})
}

// running reports a message without counts.
func (t *tracker) running(msg string) {
	t.send(ProgressEvent{Status: StatusRunning, Message: msg})
}

// tick reports item-level progress. It is dropped when the previous tick was
// sent less than tickInterval ago, unless force is set (use it for the last
// item so the final count is always seen).
func (t *tracker) tick(done, total int, unit, detail string, force bool) {
	now := time.Now()
	if !force && now.Sub(t.lastTick) < tickInterval {
		return
	}
	t.lastTick = now
	t.send(ProgressEvent{Status: StatusRunning, Done: done, Total: total, Unit: unit, Detail: detail})
}

func (t *tracker) completed(msg string) {
	t.send(ProgressEvent{Status: StatusCompleted, Message: msg, Elapsed: time.Since(t.start)})
}

func (t *tracker) completedf(format string, args ...any) {
	t.completed(fmt.Sprintf(format, args...))
}

func (t *tracker) skipped(msg string) {
	t.send(ProgressEvent{Status: StatusSkipped, Message: msg, Elapsed: time.Since(t.start)})
}

func (t *tracker) failed(msg string, err error) {
	t.send(ProgressEvent{Status: StatusFailed, Message: msg, Error: err, Elapsed: time.Since(t.start)})
}

// streamOutput runs cmd and calls onLine with each line of its combined
// output as it arrives, so a scanner can report progress while a long
// command (go test, go vet) is still running. It returns the full output and
// the command's exit error, like CombinedOutput.
func streamOutput(cmd *exec.Cmd, onLine func(line string)) ([]byte, error) {
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw
	if err := cmd.Start(); err != nil {
		_ = pw.Close()
		return nil, err
	}
	waitErr := make(chan error, 1)
	go func() {
		// Wait also waits for the copy into pw to finish, which needs the
		// reader below to keep draining, so it must run concurrently.
		err := cmd.Wait()
		_ = pw.Close()
		waitErr <- err
	}()

	var buf bytes.Buffer
	r := bufio.NewReader(pr)
	for {
		line, err := r.ReadString('\n')
		if line != "" {
			buf.WriteString(line)
			onLine(strings.TrimRight(line, "\r\n"))
		}
		if err != nil {
			break
		}
	}
	return buf.Bytes(), <-waitErr
}
