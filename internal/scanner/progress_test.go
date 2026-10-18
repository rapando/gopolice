package scanner

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func collect(ch chan ProgressEvent) []ProgressEvent {
	close(ch)
	var out []ProgressEvent
	for ev := range ch {
		out = append(out, ev)
	}
	return out
}

func TestTrackerLifecycleAndTicks(t *testing.T) {
	ch := make(chan ProgressEvent, 100)
	tr := newTracker(ch, "tests")
	tr.started("Running tests")
	tr.step(0, 10, "tests", "Found 10 tests", "")
	// Ticks inside the interval are dropped unless forced.
	tr.tick(1, 10, "tests", "TestA", false)
	tr.tick(2, 10, "tests", "TestB", false)
	tr.tick(10, 10, "tests", "TestJ", true)
	tr.completedf("Ran %d tests", 10)

	events := collect(ch)
	var kinds []string
	for _, ev := range events {
		if ev.Scanner != "tests" {
			t.Errorf("scanner = %q", ev.Scanner)
		}
		switch {
		case ev.IsTick():
			kinds = append(kinds, "tick:"+ev.Detail)
		default:
			kinds = append(kinds, string(ev.Status))
		}
	}
	want := "started running tick:TestJ completed"
	if got := strings.Join(kinds, " "); got != want {
		t.Errorf("events = %q, want %q", got, want)
	}
	last := events[len(events)-1]
	if last.Message != "Ran 10 tests" || last.Elapsed <= 0 {
		t.Errorf("completed event = %+v", last)
	}
}

func TestTrackerTickAfterInterval(t *testing.T) {
	ch := make(chan ProgressEvent, 100)
	tr := newTracker(ch, "x")
	tr.tick(1, 2, "files", "a.go", false)
	tr.lastTick = time.Now().Add(-2 * tickInterval)
	tr.tick(2, 2, "files", "b.go", false)
	events := collect(ch)
	if len(events) != 2 || events[1].Done != 2 || events[1].Total != 2 || events[1].Unit != "files" {
		t.Errorf("events = %+v", events)
	}
}

func TestTrackerNilChannel(t *testing.T) {
	tr := newTracker(nil, "x")
	tr.started("ok") // must not panic
	tr.tick(1, 1, "", "", true)
}

func TestIsTick(t *testing.T) {
	cases := []struct {
		ev   ProgressEvent
		want bool
	}{
		{ProgressEvent{Status: StatusRunning, Done: 3, Total: 9}, true},
		{ProgressEvent{Status: StatusRunning, Detail: "pkg"}, true},
		{ProgressEvent{Status: StatusRunning, Message: "step", Done: 1, Total: 2}, false},
		{ProgressEvent{Status: StatusCompleted, Done: 9, Total: 9}, false},
		{ProgressEvent{Status: StatusRunning}, false},
	}
	for _, c := range cases {
		if got := c.ev.IsTick(); got != c.want {
			t.Errorf("IsTick(%+v) = %v, want %v", c.ev, got, c.want)
		}
	}
}

func TestInventoryTests(t *testing.T) {
	inv := inventoryTests(filepath.Join("testdata", "withtests"))
	if inv.Tests == 0 || inv.Packages != 1 {
		t.Errorf("inventory = %+v, want tests > 0 in 1 package", inv)
	}
	if inv := inventoryTests(filepath.Join("testdata", "simple")); inv.Tests != 0 || inv.Packages != 0 {
		t.Errorf("simple project inventory = %+v, want none", inv)
	}
}

func TestIsTestFunc(t *testing.T) {
	for name, want := range map[string]bool{
		"TestFoo": true, "Test_foo": true, "Test1": true, "Test": true,
		"Testing": false, "Testfoo": false, "Foo": false,
	} {
		if got := isTestFunc(name, "Test"); got != want {
			t.Errorf("isTestFunc(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestGoFiles(t *testing.T) {
	dir := filepath.Join("testdata", "withtests")
	all := goFiles(dir, true)
	src := goFiles(dir, false)
	if len(all) <= len(src) || len(src) == 0 {
		t.Errorf("goFiles: all=%d src=%d", len(all), len(src))
	}
	for _, f := range src {
		if strings.HasSuffix(f, "_test.go") {
			t.Errorf("test file in source list: %s", f)
		}
	}
}

func TestStreamOutput(t *testing.T) {
	var lines []string
	out, err := streamOutput(exec.Command("sh", "-c", "echo one; echo two 1>&2; printf 'three'"), func(l string) {
		lines = append(lines, l)
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(lines, ","); got != "one,two,three" {
		t.Errorf("lines = %q", got)
	}
	if string(out) != "one\ntwo\nthree" {
		t.Errorf("output = %q", out)
	}

	_, err = streamOutput(exec.Command("sh", "-c", "echo partial; exit 3"), func(string) {})
	if err == nil {
		t.Error("expected exit error")
	}
}

func TestTestScannerReportsCounts(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go not installed")
	}
	ch := make(chan ProgressEvent, 1000)
	s := NewTestScanner()
	cfg := testConfig(filepath.Join("testdata", "withtests"))
	if _, err := s.Run(t.Context(), cfg, ch); err != nil {
		t.Fatal(err)
	}
	var ticks []ProgressEvent
	for _, ev := range collect(ch) {
		if ev.IsTick() {
			ticks = append(ticks, ev)
		}
	}
	if len(ticks) == 0 {
		t.Fatal("no ticks reported")
	}
	last := ticks[len(ticks)-1]
	if last.Unit != "tests" || last.Total == 0 || last.Done != last.Total {
		t.Errorf("final tick = %+v, want done == total tests", last)
	}
}
