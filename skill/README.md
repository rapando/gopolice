# gopolice skill

An agent skill that teaches AI coding assistants to audit Go projects with
[gopolice](https://github.com/rapando/gopolice) and fix what they find.

- `SKILL.md` is the skill. Agents read this.
- `references/report-schema.md` documents the JSON report.
- `scripts/triage.py` turns a report into a prioritised fix list and diffs two reports.

Package it for distribution with `make skill` from the repository root, which
writes `bin/gopolice-skill.zip`.

User documentation for the published skill: [docs/agensi-skill.md](../docs/agensi-skill.md).
