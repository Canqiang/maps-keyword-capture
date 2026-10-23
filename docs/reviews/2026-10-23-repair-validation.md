# Repair validation — 2026-10-23

Base commit: `2841b33c7fc4bd47f0a3b92c4401f0de8590d086`.
Repair branch: `codex/fix-scan-consistency-20261023`.

| Check | Final result |
|---|---|
| npm contract and unit suite | 1,665 passed, 87 files; 09:47:10 Asia/Shanghai start, 103.08 seconds |
| TypeScript typecheck | Passed |
| TypeScript build | Passed |
| Python runtime suite | 30 passed |
| Whitespace diff check | Passed |
| Independent code review | No remaining blockers after follow-up |

Scope and recovery: [scan consistency handoff](../scan-consistency-handoff.md).

This is local verification using fixtures and mocked infrastructure. No cloud build, remote push, deployment, collection, shared keyword modification, or historical data rewrite occurred. The baseline review and reproduction output are preserved separately; they are not the repaired runtime's result.
