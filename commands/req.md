---
description: Manage requirements (add/list/show/done/active/rm)
argument-hint: "<add|list|show|done|active|rm> [args...]"
allowed-tools: ["Bash"]
---

Run `node ${CLAUDE_PLUGIN_ROOT}/bin/codepr.js req $ARGUMENTS` and report the output verbatim. Do not paraphrase or trim. If the user asked to add a PRD and the file path is relative, resolve it from the current working directory.
