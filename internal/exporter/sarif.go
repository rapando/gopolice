package exporter

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"

	"github.com/rapando/gopolice/internal/model"
)

const (
	sarifSchema = "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemas/sarif-schema-2.1.0.json"
	sarifVersion = "2.1.0"
)

func ExportSARIF(result *model.ScanResult, version string, w io.Writer) error {
	rules := buildRules(result.Issues)

	sarifResults := make([]interface{}, 0, len(result.Issues))
	for _, iss := range result.Issues {
		ruleID := ruleID(iss.Scanner, iss.Rule)
		ruleIdx := -1
		for i, r := range rules {
			if r["id"] == ruleID {
				ruleIdx = i
				break
			}
		}

		level := "note"
		switch iss.Severity {
		case model.SeverityError:
			level = "error"
		case model.SeverityWarning:
			level = "warning"
		}

		loc := map[string]interface{}{
			"physicalLocation": map[string]interface{}{
				"artifactLocation": map[string]interface{}{
					"uri": iss.File,
				},
				"region": map[string]interface{}{
					"startLine": iss.Line,
				},
			},
		}
		if iss.Column > 0 {
			region := loc["physicalLocation"].(map[string]interface{})["region"].(map[string]interface{})
			region["startColumn"] = iss.Column
		}

		r := map[string]interface{}{
			"ruleId":    ruleID,
			"ruleIndex": ruleIdx,
			"level":     level,
			"message": map[string]interface{}{
				"text": iss.Message,
			},
			"locations": []interface{}{loc},
			"properties": map[string]interface{}{
				"category": string(iss.Category),
				"scanner":  iss.Scanner,
			},
		}
		if iss.Module != "" {
			r["properties"].(map[string]interface{})["module"] = iss.Module
		}
		sarifResults = append(sarifResults, r)
	}

	driver := map[string]interface{}{
		"name":           "gopolice",
		"version":        version,
		"informationUri": "https://github.com/rapando/gopolice",
	}
	if len(rules) > 0 {
		driver["rules"] = rules
	}

	run := map[string]interface{}{
		"tool": map[string]interface{}{
			"driver": driver,
		},
		"results": sarifResults,
		"properties": map[string]interface{}{
			"project_name": result.ProjectName,
			"scan_time":    result.ScanTime,
			"duration":     result.Duration.String(),
		},
	}

	if result.TestResults != nil {
		run["properties"].(map[string]interface{})["tests_total"] = result.TestResults.Total.Total
		run["properties"].(map[string]interface{})["tests_passed"] = result.TestResults.Total.Passed
		run["properties"].(map[string]interface{})["tests_failed"] = result.TestResults.Total.Failed
		run["properties"].(map[string]interface{})["tests_skipped"] = result.TestResults.Total.Skipped
		run["properties"].(map[string]interface{})["coverage"] = avgCoverage(result.TestResults)
	}

	if result.DepGraph != nil {
		run["properties"].(map[string]interface{})["dep_edges"] = len(result.DepGraph.Edges)
	}

	sarif := map[string]interface{}{
		"$schema": sarifSchema,
		"version": sarifVersion,
		"runs":    []interface{}{run},
	}

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(sarif)
}

func ruleID(scanner, rule string) string {
	if rule == "" {
		return scanner
	}
	return scanner + "/" + rule
}

func buildRules(issues []model.Issue) []map[string]interface{} {
	seen := make(map[string]model.Issue)
	for _, iss := range issues {
		id := ruleID(iss.Scanner, iss.Rule)
		if _, ok := seen[id]; !ok {
			seen[id] = iss
		}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	rules := make([]map[string]interface{}, 0, len(ids))
	for _, id := range ids {
		iss := seen[id]
		level := "warning"
		switch iss.Severity {
		case model.SeverityError:
			level = "error"
		case model.SeverityInfo:
			level = "note"
		}

		desc := iss.Message
		if iss.Rule != "" {
			desc = fmt.Sprintf("%s: %s", iss.Rule, iss.Message)
		}

		rule := map[string]interface{}{
			"id": id,
			"shortDescription": map[string]interface{}{
				"text": desc,
			},
			"fullDescription": map[string]interface{}{
				"text": desc,
			},
			"defaultConfiguration": map[string]interface{}{
				"level": level,
			},
			"properties": map[string]interface{}{
				"category": string(iss.Category),
				"scanner":  iss.Scanner,
			},
		}
		if iss.Solution != "" {
			rule["help"] = map[string]interface{}{
				"text":      iss.Solution,
				"markdown":  iss.Solution,
			}
		}
		rules = append(rules, rule)
	}
	return rules
}

func avgCoverage(tr *model.TestResult) float64 {
	if len(tr.Packages) == 0 {
		return 0
	}
	sum := 0.0
	for _, p := range tr.Packages {
		sum += p.Coverage
	}
	return sum / float64(len(tr.Packages))
}
