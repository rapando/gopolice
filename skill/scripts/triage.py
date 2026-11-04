#!/usr/bin/env python3
"""Triage a gopolice JSON report.

Usage:
  python3 triage.py report.json [--max N] [--scanner NAME] [--compare before.json]

Reads the report written by `gopolice scan --output json` (or the cached
.gopolice/cache/result.json), prints the grade, tool status, test summary
and the issues ordered by what to fix first. With --compare it diffs two
reports by scanner, rule, file and message. Standard library only; no network, no shell.
"""
import argparse
import json
import sys
from collections import Counter

SEVERITY_POINTS = {"error": 10, "warning": 3, "info": 1}

# Lower rank fixes first.
SCANNER_RANK = {
    "go test": 0,
    "govulncheck": 1,
    "gosec": 2,
    "go vet": 3,
    "golangci-lint": 4,
    "deadcode": 5,
    "complexity": 6,
}
SEVERITY_RANK = {"error": 0, "warning": 1, "info": 2}


def grade(issues):
    points = sum(SEVERITY_POINTS.get(i.get("severity", "info"), 1) for i in issues)
    if points == 0:
        return "A", points
    if points <= 15:
        return "B", points
    if points <= 40:
        return "C", points
    if points <= 80:
        return "D", points
    return "F", points


def sort_key(issue):
    return (
        SEVERITY_RANK.get(issue.get("severity"), 3),
        SCANNER_RANK.get(issue.get("scanner"), 9),
        issue.get("file", ""),
        issue.get("line", 0),
    )


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def fmt_issue(i):
    loc = f"{i.get('file', '?')}:{i.get('line', 0)}"
    if i.get("column"):
        loc += f":{i['column']}"
    mod = f" [{i['module']}]" if i.get("module") else ""
    line = f"  {i.get('severity', '?'):7} {i.get('scanner', '?')}/{i.get('rule', '?')}{mod}  {loc}\n"
    line += f"          {i.get('message', '').strip()}\n"
    if i.get("solution") and i["solution"].strip() != i.get("message", "").strip():
        line += f"          fix: {i['solution'].strip()}\n"
    return line


def print_summary(report, max_issues, scanner_filter):
    issues = report.get("issues") or []
    g, points = grade(issues)
    print(f"Project: {report.get('project_name', '?')}   Grade: {g} ({points} points)")
    print(f"Files: {report.get('go_files', 0)} Go files, {report.get('total_lines', 0)} lines")
    if report.get("modules"):
        print(f"Modules: {', '.join(report['modules'])}")
    print()

    tools = report.get("tools") or []
    if tools:
        print("Tools:")
        for t in tools:
            status = t.get("status", "?")
            extra = ""
            if status == "missing" and t.get("install"):
                extra = f"  (install: {t['install']})"
            elif status == "failed" and t.get("error"):
                extra = f"  ({t['error'].strip()[:120]})"
            print(f"  {status:8} {t.get('tool', '?'):16} findings={t.get('findings', 0)}{extra}")
        gaps = [t["tool"] for t in tools if t.get("status") in ("missing", "failed")]
        if gaps:
            print(f"  NOTE: {', '.join(gaps)} did not run; those areas are unchecked, not clean.")
        print()

    tr = report.get("test_results")
    if tr:
        tot = tr.get("total", {})
        # Packages without tests have no coverage to speak of; the web UI
        # averages over tested packages only, so match it.
        pkgs = [p for p in tr.get("packages") or [] if p.get("tests")]
        covered = [p.get("coverage", 0.0) for p in pkgs]
        avg = sum(covered) / len(covered) if covered else 0.0
        print(
            f"Tests: {tot.get('passed', 0)} passed, {tot.get('failed', 0)} failed, "
            f"{tot.get('skipped', 0)} skipped of {tot.get('total', 0)}; "
            f"avg coverage {avg:.1f}% over {len(pkgs)} tested packages"
        )
        low = sorted((p for p in pkgs if p.get("coverage", 0) < 50), key=lambda p: p.get("coverage", 0))
        for p in low[:5]:
            print(f"  low coverage {p.get('coverage', 0):5.1f}%  {p.get('name')}")
        print()

    by_sev = Counter(i.get("severity") for i in issues)
    by_scanner = Counter(i.get("scanner") for i in issues)
    print(
        f"Issues: {len(issues)} total; "
        f"{by_sev.get('error', 0)} error, {by_sev.get('warning', 0)} warning, {by_sev.get('info', 0)} info"
    )
    print("  by scanner: " + ", ".join(f"{k}={v}" for k, v in sorted(by_scanner.items())))
    print()

    if scanner_filter:
        issues = [i for i in issues if i.get("scanner") == scanner_filter]
    issues = sorted(issues, key=sort_key)
    print(f"Fix order (showing {min(max_issues, len(issues))} of {len(issues)}):")
    for i in issues[:max_issues]:
        sys.stdout.write(fmt_issue(i))
    if len(issues) > max_issues:
        print(f"  ... {len(issues) - max_issues} more; rerun with --max {len(issues)}")

    bench = report.get("benchmarks") or []
    profile = report.get("profile") or {}
    pkg_profiles = profile.get("packages") or []
    prof = profile.get("cpu") or []
    if bench or prof or pkg_profiles:
        print()
        if bench:
            slow = sorted(bench, key=lambda b: b.get("time_per_op", 0), reverse=True)[:5]
            print("Slowest benchmarks (ns/op, allocs/op):")
            for b in slow:
                print(f"  {b.get('time_per_op', 0):>12,} ns  {b.get('allocs_per_op', 0):>6} allocs  {b.get('name')}")
        if pkg_profiles:
            # Percentages are per package; the merged list would sum past 100%.
            print("CPU hot spots per package (flat %, runtime frames skipped):")
            for pp in pkg_profiles:
                entries = [e for e in pp.get("cpu") or [] if not e.get("function", "").startswith(("runtime.", "syscall."))]
                hot = sorted(entries, key=lambda e: e.get("flat_pct", 0), reverse=True)[:3]
                if hot:
                    print(f"  {pp.get('package')}")
                    for e in hot:
                        print(f"    {e.get('flat_pct', 0):5.1f}%  {e.get('function')}")
        elif prof:
            hot = sorted(prof, key=lambda e: e.get("flat_pct", 0), reverse=True)[:5]
            print("CPU hot spots (flat %, merged across packages):")
            for e in hot:
                print(f"  {e.get('flat_pct', 0):5.1f}%  {e.get('function')}")


def issue_key(i):
    # Not the id: some scanners reuse one id for same-named functions in a
    # file. Line numbers move when code above them changes, so leave them out.
    # A govulncheck finding is one per vulnerability; the file is just the
    # first call site govulncheck happened to report, which varies between
    # runs, so compare those by rule and message alone.
    if i.get("scanner") == "govulncheck":
        return (i.get("scanner"), i.get("rule"), None, i.get("message", "").strip())
    return (i.get("scanner"), i.get("rule"), i.get("file"), i.get("message", "").strip())


def print_compare(after, before, max_issues):
    # Count issues per key so several identical findings in one file (four
    # stale nolint directives, say) are compared four to four, not one to one.
    a_all = after.get("issues") or []
    b_all = before.get("issues") or []
    a_by, b_by = {}, {}
    for i in a_all:
        a_by.setdefault(issue_key(i), []).append(i)
    for i in b_all:
        b_by.setdefault(issue_key(i), []).append(i)
    ga, pa = grade(a_all)
    gb, pb = grade(b_all)
    print(f"Grade: {gb} ({pb} points) -> {ga} ({pa} points)")
    tb = (before.get("test_results") or {}).get("total", {})
    ta = (after.get("test_results") or {}).get("total", {})
    if tb or ta:
        print(f"Failed tests: {tb.get('failed', 0)} -> {ta.get('failed', 0)}")
    fixed, new = [], []
    for k in set(a_by) | set(b_by):
        a_list, b_list = a_by.get(k, []), b_by.get(k, [])
        if len(b_list) > len(a_list):
            fixed += b_list[len(a_list):]
        elif len(a_list) > len(b_list):
            new += a_list[len(b_list):]
    print(f"Fixed: {len(fixed)}   New: {len(new)}   Unchanged: {len(a_all) - len(new)}")
    if new:
        print("\nNew issues:")
        for i in sorted(new, key=sort_key)[:max_issues]:
            sys.stdout.write(fmt_issue(i))
    if fixed:
        print("\nFixed issues:")
        for i in sorted(fixed, key=sort_key)[:max_issues]:
            sys.stdout.write(fmt_issue(i))


def main():
    ap = argparse.ArgumentParser(description="Triage a gopolice JSON report.")
    ap.add_argument("report", help="path to gopolice JSON output")
    ap.add_argument("--max", type=int, default=25, help="issues to list (default 25)")
    ap.add_argument("--scanner", help="only list issues from this scanner (gosec, govulncheck, golangci-lint, 'go vet', 'go test', deadcode, complexity)")
    ap.add_argument("--compare", metavar="BEFORE", help="earlier report to diff against")
    args = ap.parse_args()

    try:
        report = load(args.report)
    except (OSError, ValueError) as e:
        print(f"cannot read {args.report}: {e}", file=sys.stderr)
        return 1

    if args.compare:
        try:
            before = load(args.compare)
        except (OSError, ValueError) as e:
            print(f"cannot read {args.compare}: {e}", file=sys.stderr)
            return 1
        print_compare(report, before, args.max)
        return 0

    print_summary(report, args.max, args.scanner)
    return 0


if __name__ == "__main__":
    sys.exit(main())
