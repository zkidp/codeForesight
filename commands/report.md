---
description: Generate self-contained HTML report (single requirement or whole project)
argument-hint: "<req-id> | --all  [--force] [--no-network]"
allowed-tools: ["Bash"]
---

Run `node ${CLAUDE_PLUGIN_ROOT}/bin/codepr.js report $ARGUMENTS` and report the output verbatim, including the generated file path so the user can open it in a browser. With `--all`, generate the project-level report at `.codepr/reports/index.html`.
