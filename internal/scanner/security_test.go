package scanner

import (
	"testing"

	"github.com/rapando/gopolice/internal/model"
)

const govulncheckStreamFixture = `{
  "config": {
    "protocol_version": "v1.0.0",
    "scanner_name": "govulncheck",
    "scanner_version": "v1.9.0"
  }
}
{
  "progress": {
    "message": "Scanning your code and 10 packages across 2 dependent modules for known vulnerabilities..."
  }
}
{
  "osv": {
    "id": "GO-2026-0001",
    "summary": "Request smuggling in example.com/web",
    "aliases": ["CVE-2026-1111"]
  }
}
{
  "finding": {
    "osv": "GO-2026-0001",
    "fixed_version": "v1.4.2",
    "trace": [
      {"module": "example.com/web", "version": "v1.4.0"}
    ]
  }
}
{
  "finding": {
    "osv": "GO-2026-0001",
    "fixed_version": "v1.4.2",
    "trace": [
      {
        "module": "example.com/web",
        "version": "v1.4.0",
        "package": "example.com/web/server",
        "function": "Serve",
        "receiver": "*Server",
        "position": {"filename": "server/server.go", "line": 40, "column": 2}
      },
      {
        "module": "example.com/myproject",
        "package": "example.com/myproject/internal/api",
        "function": "Start",
        "position": {"filename": "internal/api/start.go", "line": 119, "column": 14}
      }
    ]
  }
}
{
  "osv": {
    "id": "GO-2026-0002",
    "summary": "Module-only vulnerability"
  }
}
{
  "finding": {
    "osv": "GO-2026-0002",
    "fixed_version": "v0.3.0",
    "trace": [
      {"module": "example.com/unused", "version": "v0.2.0"}
    ]
  }
}
{
  "finding": {
    "osv": "GO-2026-0004",
    "trace": [
      {
        "module": "example.com/nofix",
        "version": "v0.1.0",
        "package": "example.com/nofix",
        "function": "Do"
      },
      {
        "module": "example.com/myproject",
        "package": "example.com/myproject",
        "function": "main"
      }
    ]
  }
}
{
  "finding": {
    "osv": "GO-2026-0003",
    "fixed_version": "v1.27.2",
    "trace": [
      {
        "module": "stdlib",
        "version": "v1.27.1",
        "package": "net/http",
        "function": "ListenAndServe",
        "position": {"filename": "src/net/http/server.go", "line": 3300, "column": 1}
      },
      {
        "module": "example.com/myproject",
        "package": "example.com/myproject",
        "function": "main",
        "position": {"filename": "main.go", "line": 12, "column": 3}
      }
    ]
  }
}
{
  "osv": {
    "id": "GO-2026-0003",
    "summary": "Denial of service in net/http"
  }
}
`

func TestParseGovulncheckOutputStream(t *testing.T) {
	issues, err := parseGovulncheckOutput([]byte(govulncheckStreamFixture))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	want := []model.Issue{
		{
			ID: "govulncheck-GO-2026-0001", Scanner: "govulncheck", Rule: "GO-2026-0001",
			Severity: model.SeverityError, Category: model.CategorySecurity,
			File: "internal/api/start.go", Line: 119, Column: 14,
			Message:  "Request smuggling in example.com/web",
			Solution: "Update example.com/web to v1.4.2 or later. See https://pkg.go.dev/vuln/GO-2026-0001.",
		},
		{
			// osv entry arrives after the finding.
			ID: "govulncheck-GO-2026-0003", Scanner: "govulncheck", Rule: "GO-2026-0003",
			Severity: model.SeverityError, Category: model.CategorySecurity,
			File: "main.go", Line: 12, Column: 3,
			Message:  "Denial of service in net/http",
			Solution: "Update Go to v1.27.2 or later. See https://pkg.go.dev/vuln/GO-2026-0003.",
		},
		{
			// No osv entry, no position on the call site, no fixed version.
			ID: "govulncheck-GO-2026-0004", Scanner: "govulncheck", Rule: "GO-2026-0004",
			Severity: model.SeverityError, Category: model.CategorySecurity,
			File: "example.com/nofix", Line: 0,
			Message:  "GO-2026-0004 in example.com/nofix",
			Solution: "No fixed version yet. See https://pkg.go.dev/vuln/GO-2026-0004.",
		},
	}

	if len(issues) != len(want) {
		t.Fatalf("got %d issues, want %d: %+v", len(issues), len(want), issues)
	}
	for i := range want {
		if issues[i] != want[i] {
			t.Errorf("issue %d:\n got  %+v\n want %+v", i, issues[i], want[i])
		}
	}
	for _, is := range issues {
		if is.Rule == "GO-2026-0002" {
			t.Errorf("module-level-only vulnerability GO-2026-0002 should not be reported")
		}
	}
}

func TestParseGovulncheckOutputEdgeCases(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{name: "empty", input: ""},
		{name: "whitespace only", input: "\n  \n"},
		{name: "legacy format is ignored", input: `{"vulns": []}`},
		{name: "unknown keys only", input: `{"SBOM": {"go_version": "go1.27.1"}} {"progress": {"message": "x"}}`},
		{name: "syntax error mid-stream", input: `{"config": {}} {"osv": {"id": `, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			issues, err := parseGovulncheckOutput([]byte(tc.input))
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %d issues", len(issues))
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(issues) != 0 {
				t.Fatalf("expected no issues, got %+v", issues)
			}
		})
	}
}
