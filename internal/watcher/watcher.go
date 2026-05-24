package watcher

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Watcher struct {
	watcher   *fsnotify.Watcher
	root      string
	onChange  func()
	debounce  time.Duration
	mu        sync.Mutex
	timer     *time.Timer
	done      chan struct{}
	skipCheck func(string) bool
}

func New(root string, debounce time.Duration, onChange func()) (*Watcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	fw := &Watcher{
		watcher:   w,
		root:      root,
		onChange:  onChange,
		debounce:  debounce,
		done:      make(chan struct{}),
		skipCheck: newSkipFilter(root),
	}

	if err := fw.addDirs(root); err != nil {
		w.Close()
		return nil, err
	}

	return fw, nil
}

func newSkipFilter(root string) func(string) bool {
	if hasTool("git") {
		cmd := exec.Command("git", "rev-parse", "--git-dir")
		cmd.Dir = root
		if cmd.Run() == nil {
			return func(path string) bool {
				base := filepath.Base(path)
				if base == ".git" {
					return true
				}
				rel, err := filepath.Rel(root, path)
				if err != nil {
					return false
				}
				if rel == "." || strings.HasPrefix(rel, "..") {
					return false
				}
				cmd := exec.Command("git", "check-ignore", "-q", rel)
				cmd.Dir = root
				return cmd.Run() == nil
			}
		}
	}
	return defaultSkipFilter()
}

func defaultSkipFilter() func(string) bool {
	return func(path string) bool {
		base := filepath.Base(path)
		if base == "." || base == ".." {
			return false
		}
		if strings.HasPrefix(base, ".") {
			return true
		}
		return base == "node_modules" || base == "vendor" || base == "dist"
	}
}

func hasTool(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func (fw *Watcher) addDirs(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if fw.skipCheck(path) {
				return filepath.SkipDir
			}
			if err := fw.watcher.Add(path); err != nil {
				log.Printf("watch add %s: %v", path, err)
			}
		}
		return nil
	})
}

func (fw *Watcher) Start() {
	go func() {
		for {
			select {
			case event, ok := <-fw.watcher.Events:
				if !ok {
					return
				}
				fw.handleEvent(event)
			case err, ok := <-fw.watcher.Errors:
				if !ok {
					return
				}
				log.Printf("watch error: %v", err)
			case <-fw.done:
				return
			}
		}
	}()
}

func (fw *Watcher) handleEvent(event fsnotify.Event) {
	if !strings.HasSuffix(event.Name, ".go") {
		return
	}

	if event.Op&(fsnotify.Create|fsnotify.Write) == 0 {
		return
	}

	if event.Op&fsnotify.Create != 0 {
		if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
			if !fw.skipCheck(event.Name) {
				fw.watcher.Add(event.Name)
			}
		}
	}

	fw.mu.Lock()
	defer fw.mu.Unlock()

	if fw.timer != nil {
		fw.timer.Stop()
	}
	fw.timer = time.AfterFunc(fw.debounce, fw.onChange)
}

func (fw *Watcher) Stop() error {
	fw.mu.Lock()
	if fw.timer != nil {
		fw.timer.Stop()
	}
	fw.mu.Unlock()
	close(fw.done)
	return fw.watcher.Close()
}
