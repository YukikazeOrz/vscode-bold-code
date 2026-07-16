# Direct VS Code source development

Bold Code's maintained application source lives on the `codex/vscode-source`
branch of this repository. The root build branch contains packaging and release
automation only.

The default build flow checks out that source branch into `vscode/` and skips
all legacy patch application. For local builds, an existing
`codex/vscode-source` working tree is preserved so uncommitted source changes
can be compiled directly.

```bash
cd vscode
git switch codex/vscode-source
# edit, test, commit and push source here
cd ..
./build-local-macos.sh
```

Set `VSCODE_SOURCE_MODE=no` only when intentionally testing the historical
Microsoft-upstream-plus-patches workflow.
