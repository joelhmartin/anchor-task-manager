# Task Manager Automation Flow Audit and Rebuild Plan

Date: 2026-04-08

## Executive Summary

The current automation setup is not just a rough UI. It is a split-brain system:

- The UI presents a blind trigger/action picker instead of a trigger-aware rule builder.
- The backend still relies on hard-coded exceptions for some "dynamic" behavior.
- The builder, API schemas, execution engine, and template-variable system do not agree on what the product supports.
- Some exposed triggers and fields do not map to real task state.

The result is exactly what the current screen suggests: users can assemble combinations that are semantically wrong, operationally confusing, or not actually supported end to end.

The rebuild should center on one principle:

`trigger -> context -> allowed actions -> allowed targets/recipients`

Not:

`trigger -> giant action dropdown`

## What Exists Today

The real task domain is reasonably clear:

- `task_items` are the primary tasks and have `name`, `status`, `due_date`, `needs_attention`, group membership, assignees, updates, files, and time entries: [server/sql/init.sql](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/sql/init.sql#L378)
- Subtasks exist as `task_subitems`: [server/sql/init.sql](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/sql/init.sql#L397)
- Assignees are modeled as a join table, not as a "completion" entity: [server/sql/init.sql](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/sql/init.sql#L408)
- Updates, files, time entries, and labels are real first-class task activity: [server/sql/init.sql](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/sql/init.sql#L416), [server/sql/init.sql](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/sql/init.sql#L426), [server/sql/init.sql](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/sql/init.sql#L438)

The event bus also exposes a sensible task event surface:

- `item.status_changed`
- `item.completed`
- `item.created`
- `item.archived`
- `update.created`
- `assignee.added`
- `assignee.removed`
- `item.updated`
- `time_entry.created`
- `file.uploaded`
- `subitem.updated`
- `label.added`
- `label.removed`

Reference: [server/services/taskEventSubscribers.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/taskEventSubscribers.js#L23)

That is enough to build a solid automation system. The problem is the system built on top of it.

## Audit Findings

### 1. Trigger and action compatibility is blind

The trigger catalog and action catalog are global static arrays, with no compatibility rules between them: [src/constants/automationTypes.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/constants/automationTypes.js#L1)

Both edit surfaces render the full action list regardless of trigger:

- Legacy dialog: [src/views/tasks/components/EditAutomationDialog.jsx](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/views/tasks/components/EditAutomationDialog.jsx#L56)
- Step dialog: [src/views/tasks/components/StepEditorDialog.jsx](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/views/tasks/components/StepEditorDialog.jsx#L197)

That is why combinations like `Item archived -> Notify assignees` are even possible.

This is the core product failure. The UI has no concept of:

- actions that make sense for a trigger
- recipients that exist in that trigger context
- actions that should be blocked
- actions that should be defaulted

### 2. The default creation flow hard-codes the wrong mental model

New automations default to `status_change -> notify_admins`: [src/views/tasks/panes/AutomationsPane.jsx](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/views/tasks/panes/AutomationsPane.jsx#L66)

The "quick create" path also hard-codes `notify_admins`: [src/views/tasks/panes/AutomationsPane.jsx](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/views/tasks/panes/AutomationsPane.jsx#L327)

That bakes in the exact static-admin bias you called out. It is not a small UX bug. It is the product teaching the wrong abstraction on day one.

### 3. "Dynamic recipient" behavior exists only as a backend special case

`notify_assignees` is not a real recipient model. It is mostly "all assignees", except for one hand-written exception:

- For `assignee_added`, it notifies only the newly added assignee: [server/services/taskAutomations.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/taskAutomations.js#L132)

That means the behavior the user actually wants is not represented in the data model. It is encoded as a one-off branch in the executor.

This is why the system feels hacky. The action should not be "notify assignees" with magic behavior. It should be a general notification action with an explicit recipient selector such as:

- `newly_added_assignee`
- `current_assignees`
- `actor`
- `creator`
- `specific_user`
- `users_with_role`

### 4. A core task behavior is already outside automations

When an assignee is manually added, the route already sends a direct notification immediately, without any automation rule at all: [server/routes/tasks.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/routes/tasks.js#L3511)

That is important. "Notify the person when assigned" is baseline task behavior, not something users should have to reconstruct via an automation recipe.

Automations should layer optional follow-up behavior on top of that, not replace the baseline product behavior.

### 5. The builder and API are out of sync

The frontend exposes `add_label` and `remove_label`: [src/constants/automationTypes.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/constants/automationTypes.js#L42)

The executor implements `add_label` and `remove_label`: [server/services/taskAutomations.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/taskAutomations.js#L352)

But the API enum does not allow either action type: [server/routes/tasks.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/routes/tasks.js#L91)

So the UI advertises actions that the API rejects.

This is a severe integrity problem because it tells us the automation system currently has no single source of truth.

### 6. The API accepts `trigger_events`, but create/update do not persist it

The schemas include `trigger_events`: [server/routes/tasks.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/routes/tasks.js#L102)

The rule engine reads `trigger_events` while matching rules: [server/services/ruleEngine.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/ruleEngine.js#L121)

But the create and update queries never write it:

- Create: [server/routes/tasks.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/routes/tasks.js#L2325)
- Update: [server/routes/tasks.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/routes/tasks.js#L2402)

That is another architecture drift signal.

### 7. Workspace scope exists in the engine, but not in the UI flow

The rule engine matches three scopes:

- board
- workspace
- global

Reference: [server/services/ruleEngine.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/ruleEngine.js#L107)

But the Automations pane only offers `board` and `global`: [src/views/tasks/panes/AutomationsPane.jsx](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/views/tasks/panes/AutomationsPane.jsx#L875)

So the system is again split between intended platform capability and exposed product capability.

### 8. The step editor is materially weaker than the legacy editor

The legacy edit dialog supports:

- member selectors
- board selectors
- group selectors
- label selectors

Reference: [src/views/tasks/components/EditAutomationDialog.jsx](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/views/tasks/components/EditAutomationDialog.jsx#L151)

The step editor only has special handling for:

- status selects
- booleans

Everything else becomes a raw text input: [src/views/tasks/components/StepEditorDialog.jsx](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/views/tasks/components/StepEditorDialog.jsx#L104)

So the newer builder is actually worse for many actions. Users end up typing raw IDs or free text where the system should be guiding them with real task entities.

### 9. Group-based actions are exposed, but `groups` is passed as an empty list

Both dialog mounts pass `groups={[]}`:

- Builder mount: [src/views/tasks/panes/AutomationsPane.jsx](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/views/tasks/panes/AutomationsPane.jsx#L840)
- List-view mount: [src/views/tasks/panes/AutomationsPane.jsx](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/views/tasks/panes/AutomationsPane.jsx#L1011)

That means actions like `move_to_group` cannot be configured correctly from the editor that claims to support them.

### 10. Some condition fields and template variables do not map to real data

The condition builder exposes `item.priority`: [src/constants/automationTypes.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/constants/automationTypes.js#L53)

The template helper exposes `item.priority` and `actor.name`: [src/views/tasks/components/TemplateVariableHelper.jsx](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/views/tasks/components/TemplateVariableHelper.jsx#L5)

But:

- `task_items` does not have a `priority` column: [server/sql/init.sql](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/sql/init.sql#L378)
- execution context does not populate `actor.name`, only `first_name` and `last_name`: [server/services/templateVariables.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/templateVariables.js#L36)

So the product advertises variables and fields that do not resolve cleanly.

### 11. `all_assignees_completed` is not backed by a real assignee-completion model

The engine implements `all_assignees_completed` by checking whether all subitems are complete, and explicitly notes that assignee completion is not modeled separately: [server/services/ruleEngine.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/ruleEngine.js#L308)

This is not a semantic distinction. It is a placeholder masquerading as a feature.

For "real tasks that can exist", this trigger should either:

- be removed from the UI until there is a real assignee-completion model, or
- be relabeled honestly as a subitem-based workflow pattern

## What the Product Should Model Instead

The automation system should be derived from real task semantics, not from generic dropdown inventories.

### Real trigger contexts

Each trigger should produce a typed context payload.

Examples:

- `assignee_added`
  - `trigger.assignee.id`
  - `trigger.assignee.name`
  - `trigger.assignee.email`
  - `trigger.added_by.id`
- `status_change`
  - `trigger.from_status`
  - `trigger.to_status`
  - `trigger.is_done_transition`
- `item_archived`
  - `trigger.archived_by.id`
  - `trigger.was_previously_assigned`
- `label_added`
  - `trigger.label.id`
  - `trigger.label.name`
  - `trigger.label.category`

The executor should not have to infer these from unrelated fields or special cases.

### Real recipient/target types

Notification actions should target semantic recipients, not hard-coded populations.

Minimum recipient model:

- `trigger_assignee`
- `current_assignees`
- `actor`
- `item_creator`
- `specific_user`
- `workspace_role`

This directly solves the "when a person is assigned, notify that person" requirement.

### Real action compatibility

Action availability should depend on trigger context.

Examples:

- `assignee_added`
  - good actions: notify assigned person, post update, set due date relative to assignment, add label, send webhook
  - questionable actions: notify all assignees
- `item_archived`
  - good actions: webhook, add update, notify creator, stop timers, remove active labels if desired
  - bad default action: notify assignees
- `status_change`
  - good actions: notify current assignees, create follow-up item, set due date, move item, add label, send email/webhook

## Rebuild Plan

### Phase 1. Establish a single source of truth for automation metadata

Create a shared automation registry consumed by both frontend and backend.

The registry should define, for each trigger:

- label
- available trigger filters
- available actions
- default action suggestions
- available context variables
- available recipient target types
- blocked combinations

This replaces the current split between:

- `src/constants/automationTypes.js`
- route enums in `server/routes/tasks.js`
- backend execution branches in `server/services/taskAutomations.js`

### Phase 2. Replace static notification actions with a semantic `notify_users` action

Deprecate:

- `notify_admins`
- `notify_assignees`

Replace them with:

- `notify_users`

Suggested config shape:

```json
{
  "recipient_mode": "trigger_assignee",
  "title": "You were assigned: {item.name}",
  "body": "Status: {item.status}"
}
```

Allowed `recipient_mode` values should be trigger-aware.

Examples:

- On `assignee_added`: `trigger_assignee`, `actor`, `current_assignees`, `workspace_role`, `specific_user`
- On `item_archived`: `item_creator`, `actor`, `workspace_role`, `specific_user`

### Phase 3. Move baseline task behaviors out of automations

Keep direct assignment notification as core product behavior.

That route already exists today: [server/routes/tasks.js](/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/routes/tasks.js#L3511)

Automations should enhance workflows, not reimplement baseline task hygiene.

Recommended rule:

- if a behavior should happen for every assignment, build it into the assignment flow
- if a behavior is optional, team-specific, or content-customizable, make it an automation

### Phase 4. Make the builder trigger-first and context-aware

The creation flow should become:

1. Pick trigger
2. Configure trigger-specific filters
3. Choose from only valid actions for that trigger
4. Configure action targets and content
5. Optionally add conditions and follow-up steps

Specific UI changes:

- Remove the blind action dropdown
- Add "Suggested actions" per trigger
- Show recipient choices in plain language
- Hide or disable semantically bad combinations
- Show the trigger context variables that actually exist

### Phase 5. Unify the legacy dialog and step editor

Right now the builder and legacy editor support different capabilities.

Fix by:

- using one field-rendering system for both legacy rule editing and step editing
- passing real board groups, members, boards, and labels into the step editor
- removing raw ID text entry for entity-backed actions

This also means fixing the current `groups={[]}` wiring in the pane.

### Phase 6. Clean up fake or drifting features

Do these immediately before adding more automation surface area:

- remove `item.priority` from conditions and variables until it is real
- remove or relabel `all_assignees_completed` until assignee completion is real
- fix `actor.name` variable support
- either persist `trigger_events` or remove it from schemas
- either expose workspace scope or remove workspace-scope matching from the platform
- align API enums with frontend action catalogs

### Phase 7. Add server-side compatibility validation

The server should reject invalid trigger/action combinations even if the UI regresses.

That validation should check:

- trigger/action compatibility
- required recipient context for the chosen action target
- required action config per action mode
- entity existence and board/workspace access

This belongs in server-side validation, not just in form state.

### Phase 8. Add high-value end-to-end automation recipes and tests

Start with flows that correspond to real task operations:

1. `assignee_added -> notify trigger_assignee`
2. `status_change(to=Ready for Review) -> notify current_assignees`
3. `due_date_relative(-1) -> mark needs_attention + notify current_assignees`
4. `item_completed -> create follow-up item in selected group`
5. `label_added(category=priority, label=High) -> notify workspace_role(admin)`
6. `item_archived -> send webhook`

Each recipe should have:

- a seeded test fixture
- a persisted automation definition
- an execution assertion
- a UI smoke path

## Recommended Immediate Implementation Order

If this were my sequence, I would do it in this order:

1. Stop exposing invalid capabilities
   - Remove fake fields and unsupported actions from the UI now.
   - Block nonsensical trigger/action combinations now.
2. Add semantic recipient support
   - Implement `notify_users` with `recipient_mode`.
   - Add `trigger.assignee` context for `assignee_added`.
3. Rebuild the creation flow around trigger compatibility
   - Trigger-first builder
   - Suggested actions
   - Real selectors for entities
4. Align the platform contract
   - one metadata registry
   - one validation model
   - one variable catalog
5. Then add more templates and higher-order flows

## Concrete Product Decisions I Recommend

### For the exact use case you raised

When a person is assigned:

- baseline product behavior should already notify that person
- automation should optionally let admins add a custom follow-up notification, update, due date, label, or webhook

Default recipe:

- Trigger: `Person assigned`
- Action: `Notify assigned person`
- Title: `You were assigned: {item.name}`
- Body: `Board: {board.name}`

### For `Item archived`

Do not surface "Notify assignees" as a suggested action.

Suggested actions should instead be:

- send webhook
- post final update
- notify item creator
- notify workspace role

If you want to keep assignee notifications technically possible at all, they should be behind an advanced action target selector, not in the default trigger action list.

## Bottom Line

The present automation flow is not failing because it lacks polish. It is failing because it lacks a domain model.

The correct fix is not to tweak dropdown labels. The correct fix is to rebuild automation creation around:

- real task events
- real execution context
- semantic recipients
- trigger-aware action compatibility
- one shared registry across UI and server

Until that exists, the product will keep generating rules that are confusing, misleading, or structurally wrong.
