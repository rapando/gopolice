package api

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/rapando/gopolice/internal/cache"
	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/history"
	"github.com/rapando/gopolice/internal/model"
	"github.com/rapando/gopolice/internal/scanner"
)

// project is one repository the server can scan: its config, latest result,
// and the subscribers watching its scan progress.
type project struct {
	id    string
	name  string
	dir   string
	cfg   *config.Config
	store *Store
	log   *scanLog

	scanMu      sync.Mutex
	scanRunning bool
}

func newProject(id, name, dir string, base *config.Config) *project {
	cfg := *base
	cfg.TargetDir = dir
	return &project{
		id:    id,
		name:  name,
		dir:   dir,
		cfg:   &cfg,
		store: NewStore(),
		log:   newScanLog(),
	}
}

// loadCached restores the last scan result from the project's cache file, if
// it has one.
func (p *project) loadCached() {
	if r, err := cache.Load(cache.ResultPath(p.dir)); err == nil {
		p.store.Set(r)
	}
}

func (p *project) scanning() bool {
	p.scanMu.Lock()
	defer p.scanMu.Unlock()
	return p.scanRunning
}

// TriggerScan runs a scan and blocks until it finishes.
func (p *project) TriggerScan(ctx context.Context) {
	p.runScan(ctx)
}

func (p *project) fail(msg string) {
	p.log.emit(scanner.ProgressEvent{Scanner: "pipeline", Status: scanner.StatusFailed, Message: msg})
}

func (p *project) runScan(ctx context.Context) {
	p.scanMu.Lock()
	if p.scanRunning {
		p.scanMu.Unlock()
		log.Printf("scan of %s already in progress, skipping", p.dir)
		return
	}
	p.scanRunning = true
	p.scanMu.Unlock()

	defer func() {
		p.scanMu.Lock()
		p.scanRunning = false
		p.scanMu.Unlock()
	}()

	start := time.Now()
	p.log.reset()
	p.log.emit(scanner.ProgressEvent{Scanner: "pipeline", Status: scanner.StatusStarted, Message: "Starting scan"})

	type outcome struct {
		result *model.ScanResult
		err    error
	}
	progress := make(chan scanner.ProgressEvent, 100)
	done := make(chan outcome, 1)

	go func() {
		result, err := scanner.RunWorkspaceScan(ctx, p.cfg, progress)
		if err == nil && result == nil {
			result, err = scanner.NewDefaultPipeline().Run(ctx, p.cfg, progress)
		}
		done <- outcome{result, err}
	}()

	for {
		select {
		case event := <-progress:
			p.log.emit(event)
		case o := <-done:
			if o.err != nil || o.result == nil {
				msg := "scan produced no result"
				if o.err != nil {
					msg = o.err.Error()
				}
				p.fail(msg)
				return
			}
			result := o.result
			result.ScanTime = start
			result.Duration = time.Since(start)
			p.store.Set(result)

			if err := cache.Save(result, cache.ResultPath(p.dir)); err != nil {
				log.Printf("cache save: %v", err)
			}
			if err := history.Save(p.dir, result); err != nil {
				log.Printf("history save: %v", err)
			}

			p.log.emit(scanner.ProgressEvent{
				Scanner: "pipeline",
				Status:  scanner.StatusCompleted,
				Message: fmt.Sprintf("Scan complete: %d issues found, took %v", len(result.Issues), result.Duration),
			})
			return
		case <-ctx.Done():
			p.fail("scan canceled")
			return
		}
	}
}
