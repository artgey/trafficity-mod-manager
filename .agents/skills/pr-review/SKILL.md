---
name: pr-review
description: Step-by-step Pull Request review workflow for trafficity-mod-manager covering both code PRs (core/runtime/examples/types) and community mod registry PRs (registry.json + ZIP sha256/security audit), ending with a clear verdict and ready-to-paste review comment.
---

# Pull Request Review Skill (`pr-review`)

Use this skill whenever reviewing an incoming Pull Request on `trafficity-mod-manager` (by PR number, URL, or branch).

## Execution Mode — Delegate to a Subagent

Always delegate the full PR inspection, download/hash verification, security audit, and test run to a dedicated subagent (`invoke_subagent` with `TypeName: "self"`, `Role: "PR Reviewer"`) so the main conversation stays clean and focused on the final verdict and maintainer decision. (Do **not** use `research`, which lacks network and shell access needed for `git fetch`, `curl`, `sha256sum`, and `npm test`.)

If no PR number is provided, list open PRs first:
```bash
curl -sS "https://api.github.com/repos/dyri0n/trafficity-mod-manager/pulls?state=open" \
  | node -e 'const list=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(list.map(p=>({number:p.number,title:p.title,user:p.user?.login,url:p.html_url})));'
```

## Step 1 — Fetch PR Metadata & Diff (Without Touching Your Working Tree)

Never overwrite uncommitted local work. Fetch the PR ref and metadata read-only first:

```bash
# Replace <N> with the PR number
curl -sS "https://api.github.com/repos/dyri0n/trafficity-mod-manager/pulls/<N>" \
  | node -e 'const p=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log({number:p.number,title:p.title,user:p.user?.login,state:p.state,base:p.base?.ref,head:p.head?.label,changed_files:p.changed_files,additions:p.additions,deletions:p.deletions,body:p.body});'

git fetch origin pull/<N>/head:pr-<N>
git diff --stat origin/main...pr-<N>
git diff origin/main...pr-<N>
```

Classify the PR into one or both tracks:
- **Track A — Community Mod / `registry.json` PR**: touches `registry.json` (adding or updating a community mod).
- **Track B — Code / Docs / Example Mod PR**: touches `src/`, `runtime/`, `types/`, `examples/`, `ui/`, `test/`, `.github/`, or `docs/`.

---

## Step 2A — Track A: Community Mod (`registry.json`) Audit

If `registry.json` changed, verify **all** of the following before approving:

1. **Schema & Uniqueness**
   - `registry.json` parses cleanly as JSON.
   - New/updated entry has `id`, `name`, `version`, `modloaderVersion`, `downloadUrl`, `sha256` (and `description` / `author`).
   - `id` is unique (does not collide with or hijack an existing mod unless the PR author is the original mod author).
   - `downloadUrl` points to a public, immutable release `.zip` (e.g. GitHub Release URL, not a mutable branch archive or suspicious host).

2. **Download, Hash & ZIP Safety Verification**
   Download the `.zip` to `/tmp` and verify its SHA-256 and contents:
   ```bash
   mkdir -p /tmp/pr-<N>-audit && cd /tmp/pr-<N>-audit
   curl -fLsS "<downloadUrl>" -o mod.zip
   sha256sum mod.zip   # MUST match registry.json sha256 exactly
   unzip -l mod.zip    # MUST NOT contain ../, absolute paths, symlinks, or unexpected binaries (.exe/.dll/.so/.bat/.sh)
   unzip -q mod.zip -d unpacked
   ```

3. **Manifest & Code Security Audit (Inside `unpacked/`)**
   Read `mod.json`, `settings.toml` (if any), and **every** `.js`/`.mjs` file in the ZIP:
   - `mod.json` has valid `id`, `name`, `version`, `entry`, `modloaderVersion` matching `registry.json`.
   - **Security red flags (automatic blocker)**:
     - Obfuscated/minified-without-source code that cannot be audited.
     - Unexpected network calls (`fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`) to external servers.
     - Dynamic code execution (`eval`, `new Function`, injecting remote `<script>` tags).
     - Reading/exfiltrating unrelated local files, cookies, tokens, or abusing `trafficityDesktop` IPC.
   - **Quality check**: Uses `TrafficityMods` / `game.*` cleanly without breaking other mods or leaking global listeners without cleanup.

---

## Step 2B — Track B: Code / Runtime / Example Mod Audit

If code or example files changed:

1. **Run Tests in an Isolated Worktree**
   ```bash
   git worktree add /tmp/pr-<N>-wt pr-<N>
   (cd /tmp/pr-<N>-wt && npm test)
   git worktree remove /tmp/pr-<N>-wt
   ```
   - `tsc -p jsconfig.json --noEmit` and all `node --test` cases **must** pass.
   - If the PR fixes a bug or adds a feature, check that tests cover it.

2. **Correctness, Security & Scope Review**
   - Does the diff actually solve the stated problem without unintended side effects?
   - Any security risks in `src/mod-api.cjs`, `src/patch.mjs`, `src/registry.mjs` (path traversal, unvalidated inputs, unsafe IPC, overwriting user `settings.toml`)?
   - Any unnecessary bloat, unrelated formatting churn, or breaking changes to existing mod APIs?

3. **DX & Type Hygiene (`mod-dx-audit`)**
   If `runtime/`, `types/`, or `examples/` changed, run the `mod-dx-audit` checks:
   - Zero `requireRouterModule` / `requireModule` / `__trafficity` leaks in `examples/`.
   - Zero bare `any` in `types/trafficity-mods.d.ts`, and every new public property/method has JSDoc.
   - Every `export default` in `examples/*/mod.js` has typed `mods` and `game` parameters.

---

## Step 3 — Produce the Review Output

Present a concise report to the maintainer with:

1. **Summary**: 1–2 sentences on what the PR does and which track(s) it falls under.
2. **Verdict**:
   - **Approve** (safe to merge)
   - **Request Changes** (list exact blockers)
   - **Needs Clarification** (list specific questions for the author)
3. **Checklist Results**:
   - Blockers (must fix before merge)
   - Non-blocking suggestions (optional improvements)
   - Verified checks (tests, SHA-256, security, DX)
4. **Ready-to-Paste GitHub Comment**: Short, polite, actionable review message the maintainer can paste directly into GitHub.
5. **Cleanup**: Remind to remove temporary branch/files (`git branch -D pr-<N>` and `rm -rf /tmp/pr-<N>-audit`) once done.
