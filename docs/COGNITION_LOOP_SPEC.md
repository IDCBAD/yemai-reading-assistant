# A+ 个人认知循环实施规格

> 状态：已发布规格
> 形成日期：2026-08-27
> GitHub Issue：[#3 实现 A+ 个人认知循环：形成、重遇与修订](https://github.com/IDCBAD/yemai-reading-assistant/issues/3)
> 产品决策来源：个人认知循环方向、独立 Markdown 认知目录 ADR、A+ 前端原型
> 交付边界：本规格描述首个可真实使用的“形成 → 重遇 → 修订”纵向闭环，不表示能力已经实现或验收。

## Problem Statement

用户在网页阅读和 AI 对话中会形成比网页摘要更有价值的个人理解，但当前页脉只能保存完整 Agent 回答作为阅读卡片。回答被保存后仍然是一次内容快照，不能表达用户究竟认可了什么、适用边界是什么、后来为何改变，也不会在未来相关网页中主动参与判断。

用户已经能够把网页内容保存到 Obsidian，再交给大模型提炼，但这些内容多数仍是别人的观点。真正稀缺的是用户在追问、反驳和重新表述后形成的理解。如果页脉继续增加网页抽取、附件格式或收藏能力，只会增加材料数量，不能让这些理解成为可追溯、会演化、以后还能被重新使用的本地知识资产。

用户需要一条克制的个人认知循环：在对话中识别可能改变理解的时刻，由用户做一次短暂但真实的确认，把结果写入独立、可读、可迁移的 Markdown 目录；未来遇到相关网页时，页脉在本地唤醒旧认知，解释为什么相关，并让用户主动决定保持、补充、修订或暂缓判断。

## Solution

在现有 Side Panel 对话体验中加入 A+ 个人认知循环。日常状态保持内联：Agent 只在确实发生认知转折时提出一条认知候选，用户完成与认知类型匹配的微型确认后，页脉把认知写入用户选择的独立 Markdown 认知目录，并在原对话中留下轻量回执。

页脉在本地读取自己创建的认知文件并建立可丢弃索引。打开新网页后，使用页面标题、结构和有限概览在本地筛选最多三条相关认知，不自动上传网页正文或认知目录。普通相关只改变知识入口状态；明确连接或潜在冲突才展示低打扰提示，并说明命中的字段和词语。

当用户主动选择“比较新旧观点”时，界面临时升起专注工作台。页脉只把当前材料的必要片段、目标认知的当前版本和有限演化摘要交给 Agent，得到支持、挑战和边界变化的结构化分析。最终决定始终由用户做出：保持原判断、修订认知或保存为待验证。处理完成后工作台退场，用户回到原对话或当前网页，并看到紧凑结果；完整演化时间线按需再次打开。

Markdown 文件是已确认认知的唯一长期事实来源。浏览器数据库只保存目录连接、候选与来源的幂等映射、文件指纹和可重建搜索索引。断开目录、清空会话历史或卸载知识索引都不得删除认知文件。

首个版本完成的定义是：用户能够在真实 Chrome 中选择目录、形成认知、关闭并重新打开 Side Panel、在另一个网页中重遇认知、完成一次保持/修订/待验证决策，并在 Obsidian 中直接读到完整、可追溯的最新 Markdown 文件。

## User Stories

1. As a new user, I want to understand that cognition is different from a reading card, so that I do not mistake an AI answer for something I have personally learned.
2. As a new user, I want to choose a dedicated local directory before saving cognition, so that I know exactly where my long-term knowledge will live.
3. As a new user, I want the directory picker to be opened only after my click, so that the browser does not request file permissions unexpectedly.
4. As a new user, I want to be warned when the selected directory is not empty, so that existing Markdown files are not silently treated as Yemai-managed cognition.
5. As a new user, I want Yemai-managed files to remain readable without Yemai-specific software, so that I can use them in Obsidian or another Markdown tool.
6. As a returning user, I want Yemai to remember the selected directory when the browser permits it, so that I do not select it every session.
7. As a returning user, I want a clear reconnect action when directory permission is no longer granted, so that recovery is understandable and user-initiated.
8. As a returning user, I want to see whether the cognition directory is ready, needs permission, is unavailable, or has errors, so that I know whether saving and resurfacing will work.
9. As a user, I want disconnecting the directory to leave every Markdown file untouched, so that disconnecting is never destructive.
10. As a user, I want clearing local conversation history to leave cognition files untouched, so that transient chat cleanup cannot erase long-term knowledge.
11. As a user, I want Yemai to ignore ordinary Markdown files without a Yemai identity, so that my unrelated notes are never imported or modified.
12. As a user, I want duplicate or malformed managed files to be reported without automatic repair, so that ambiguous data is not silently overwritten.
13. As a learner, I want the Agent to propose cognition only after a meaningful change in understanding, so that the conversation is not covered in low-value prompts.
14. As a learner, I want at most one cognition candidate for a completed Agent answer, so that one response does not create confirmation fatigue.
15. As a learner, I want streaming, stopped, or failed answers to produce no cognition candidate, so that incomplete material is not promoted as knowledge.
16. As a learner, I want a candidate to state the proposed understanding and what changed, so that I can judge whether it represents my learning.
17. As a learner, I want the confirmation question to match the cognition type, so that the interaction requires genuine processing rather than a generic approval click.
18. As a learner forming a concept, I want to explain it in my own words, so that the saved cognition reflects comprehension.
19. As a learner forming a causal model, I want to explain why the effect occurs, so that the saved cognition contains a usable mechanism.
20. As a learner forming a judgment principle, I want to state when it does not apply, so that the saved cognition includes boundaries.
21. As a learner recording a decision, I want to state the trade-off I accepted, so that the saved cognition remains useful after the immediate context is forgotten.
22. As a learner recording a hypothesis, I want to state what evidence is missing, so that uncertainty is preserved instead of disguised as certainty.
23. As a learner recording a method, I want to state when or how it should be used, so that the saved cognition can guide future action.
24. As a learner, I want to edit the proposed confirmation answer before saving, so that Agent wording does not become my knowledge without my involvement.
25. As a learner, I want to dismiss a candidate without writing anything, so that Yemai remains an assistant rather than an automatic note factory.
26. As a learner, I want a dismissed candidate to remain dismissed after reopening the conversation, so that the same prompt does not reappear.
27. As a learner without a connected directory, I want a candidate to remain visible while I connect one, so that a valuable moment is not lost.
28. As a learner, I want saving to succeed locally before the interface claims that cognition exists, so that confirmation feedback is truthful.
29. As a learner, I want a retryable error when a file cannot be written, so that a permission or disk problem does not silently lose my confirmation.
30. As a learner, I want repeated confirmation or retry to update one cognition rather than create duplicates, so that transient failures remain idempotent.
31. As a learner, I want a compact receipt in the original conversation after saving, so that I can continue asking questions without a permanent knowledge panel.
32. As a learner, I want the receipt to show the cognition title and directory status, so that I know what was saved and where it belongs.
33. As an Obsidian user, I want each cognition to have a stable identity independent of its filename, so that renaming or retitling does not create a new cognition.
34. As an Obsidian user, I want the filename to remain stable after creation, so that links are not broken every time the cognition evolves.
35. As an Obsidian user, I want current understanding, reasoning, boundary, unresolved questions, sources, and evolution history to be human-readable sections, so that the file is useful outside Yemai.
36. As an Obsidian user, I want unknown frontmatter and content outside Yemai-managed sections to be preserved, so that my own annotations survive future updates.
37. As an Obsidian user, I want external edits to be reread before Yemai updates a cognition, so that stale browser state does not overwrite my latest changes.
38. As an Obsidian user, I want a malformed externally edited managed section to block automatic updates, so that Yemai does not guess how to repair my file.
39. As a reader, I want Yemai to build the cognition index locally, so that my full directory is not uploaded merely because I opened a webpage.
40. As a reader, I want indexing to include only Yemai-managed files, so that ordinary notes do not enter matching or Agent context.
41. As a reader, I want the index to rebuild from Markdown files, so that deleting browser-derived data never destroys or invalidates my knowledge.
42. As a reader, I want directory scans to be throttled and explicit when expensive, so that opening the Side Panel remains responsive as cognition grows.
43. As a reader, I want the current page to be matched using limited local signals first, so that a normal page visit does not upload the page or trigger an Agent call.
44. As a reader, I want exact source pages that originally formed a cognition to be excluded from ordinary resurfacing, so that reopening the same page does not masquerade as a new encounter.
45. As a reader, I want at most three related cognitions to be surfaced, so that the feature remains a useful signal rather than a recommendation feed.
46. As a reader, I want every resurfaced cognition to explain why it is related, so that I can distinguish a meaningful connection from keyword coincidence.
47. As a reader, I want weak matches to change only the knowledge entry state, so that marginal relevance does not interrupt reading.
48. As a reader, I want a stronger but restrained prompt for a potential conflict, so that important contradictions are visible without becoming alarming.
49. As a reader, I want to defer a resurfaced cognition for the current page without modifying it, so that ignoring a prompt does not become a knowledge event.
50. As a reader, I want false-positive dismissal to affect only the current match, so that one poor match does not delete or downgrade the underlying cognition.
51. As a reader, I want to open a resurfaced cognition and read its current understanding before involving the Agent, so that basic inspection remains local.
52. As a reader, I want cloud comparison to start only after I click “compare new and old views,” so that sending material to the Agent is an explicit choice.
53. As a privacy-conscious user, I want comparison to send only the target cognition and necessary current-page material, so that unrelated cognition and conversation history remain local.
54. As a privacy-conscious user, I want the comparison request to use a transient analysis context rather than mutate my visible conversation memory, so that invisible analysis does not contaminate later answers.
55. As a reader, I want the focused workbench to show my old understanding and the new material side by side, so that the decision is inspectable.
56. As a reader, I want the workbench to distinguish support, challenge, and a possible boundary change, so that semantic similarity is not presented as a conclusion.
57. As a reader, I want to return to the current article without deciding, so that opening the workbench is reversible.
58. As a reader, I want an Agent comparison failure to leave the cognition unchanged, so that network or parsing errors cannot create knowledge events.
59. As a learner, I want to keep my current understanding when the new material fits its boundary, so that evidence can accumulate without unnecessary rewriting.
60. As a learner, I want to revise the current understanding or boundary when the new evidence changes it, so that cognition can evolve instead of multiplying into contradictory notes.
61. As a learner, I want to mark the conflict as waiting for evidence, so that uncertainty is retained without forcing a premature judgment.
62. As a learner, I want every resolution to record what changed, why, when, and from which page, so that the evolution remains traceable.
63. As a learner, I want “keep” to preserve the current text while appending a support event, so that unchanged knowledge still records meaningful evidence.
64. As a learner, I want “revise” to update the current sections and append the previous and new states to history, so that revision never erases the reasoning path.
65. As a learner, I want “wait for evidence” to preserve the current understanding and record an unresolved challenge, so that contested cognition can resurface later.
66. As a learner, I want the file write to complete and validate before the workbench reports success, so that the UI never gets ahead of durable storage.
67. As a learner, I want the workbench to close after successful processing and leave a compact result in context, so that I return naturally to reading or conversation.
68. As a learner, I want to reopen the evolution timeline from the compact result, so that details remain available without permanent screen occupation.
69. As a keyboard user, I want every candidate, directory, comparison, and return action to be reachable with a visible focus state, so that the loop does not depend on a pointer.
70. As a screen-reader user, I want status changes and errors announced without moving focus unexpectedly, so that asynchronous file and Agent work remains understandable.
71. As a user who reduces motion, I want workbench transitions to become effectively immediate, so that the feature respects my system preference.
72. As a narrow Side Panel user, I want the complete loop to work at 300 to 430 pixels without horizontal scrolling, so that it remains usable in realistic browser layouts.
73. As a user, I want Yemai to preserve cognition when its source conversation is archived or deleted, so that long-term knowledge does not depend on chat retention.
74. As a user, I want a missing source conversation to disable only the “return to conversation” link, so that the cognition and its web sources remain readable.
75. As a user, I want local backup messaging to explain that the independent cognition directory is not duplicated inside the browser backup, so that I understand what each recovery mechanism protects.
76. As a user, I want the first release to avoid global graphs, automated review schedules, and theme dashboards, so that the product proves the cognition loop before expanding its surface area.

## Implementation Decisions

### 1. Delivery scope and state model

- Implement one vertical slice: cognition candidate, micro-confirmation, directory write, local indexing, page resurfacing, focused comparison, resolution, Markdown update, and evolution display.
- Preserve the A+ interaction hierarchy validated by the prototype: inline by default, focused workbench only for comparison and revision, local relationship/evolution detail only when relevant.
- The prototype state sequence is retained as the product state model: discovered candidate → confirming → persisted → resurfaced → comparing → resolved. Dismiss and defer are exits that do not create cognition or cognition events.
- Do not introduce a permanent cognition dashboard or split-pane layout in this slice.

### 2. Highest application Seam

- Introduce one Side Panel-facing cognition-loop application service as the main behavioral Seam.
- The application service owns commands and resulting projections for connecting a directory, accepting or dismissing a candidate, confirming cognition, scanning files, finding reencounters, starting a comparison, resolving it, and returning to context.
- UI components receive state projections and invoke commands; they do not read files, parse Markdown, query the index, or call WorkOS directly.
- The application service depends on replaceable directory, local index, and Agent-analysis adapters, but tests enter through the application service whenever the behavior spans more than one adapter.
- Keep cognition state separate from `WorkspaceState`. A cognition may outlive its source conversation, and frequent file/index updates must not rewrite the conversation workspace.

### 3. Candidate transport and existing Agent interaction reuse

- Extend the recommended Agent protocol with an optional, fixed cognition-candidate A2UI decision schema. The Agent emits it only after providing enough explanatory answer text and only when the conversation meets the documented candidate signals.
- Recognize cognition candidates through a versioned, allow-listed decision purpose and fixed semantic fields. Unknown or malformed A2UI interrupts continue through the existing generic decision UI and are never treated as cognition.
- Reuse the existing interrupt lifecycle, persistence, retry behavior, and safe SSE projection. Do not introduce a second invisible chat transcript or scrape candidate data from arbitrary Markdown.
- A candidate contains an Agent-proposed title, type, current understanding, changed-from summary, rationale, boundary, unresolved questions, source identity, and one type-specific confirmation question.
- The user must supply or edit the confirmation answer. Agent defaults may prefill supporting fields, but a one-click untouched approval is not sufficient for a formal cognition.
- Persist dismissed/replied candidate state through the existing message interaction so reopening a conversation does not recreate the prompt.
- Generate no candidate from an incomplete Agent message. Candidate eligibility is evaluated only for a completed response, and one assistant message can own at most one candidate interaction.
- On confirmation, persist and reread-validate the cognition file before submitting the A2UI interrupt resolution. If remote resolution then fails, report “saved locally, Agent not yet resumed” and retry only the remote resolution without rewriting or duplicating the cognition.
- Update the copyable recommended Agent template and its documentation together with the implementation. If a configured Agent does not emit the versioned schema, chat continues normally without candidate UI.

### 4. Cognition types and micro-confirmation

- Support six initial cognition types: concept, causal model, judgment principle, method, decision basis, and hypothesis.
- Map each type to one primary micro-confirmation: explain in your own words; explain why it occurs; state when it does not apply; state when/how to use it; state the accepted trade-off; or state the missing evidence.
- Keep the default interaction completable in roughly 30 seconds. Show the primary confirmation field first and place optional Agent-proposed details behind progressive disclosure.
- Reject an empty primary confirmation locally. Dismissal remains available and writes no cognition file.

### 5. Directory connection and permission behavior

- Add a cognition-directory section to settings with four explicit states: not configured, ready, permission required, and error/unavailable.
- Directory selection and permission requests must begin from a user gesture. Startup may inspect existing permission state but must not open a picker or permission prompt automatically.
- Store only the browser-provided opaque directory connection and display name. Do not infer or claim to know an absolute local path that the browser does not provide.
- If the chosen directory contains existing content, explain that Yemai imports nothing and manages only files with valid Yemai cognition identity. Require explicit confirmation before accepting a non-empty directory.
- Disconnect removes the saved connection and derived index, then leaves every file in the directory untouched.
- If the required browser directory capability is unavailable, disable persistence and clearly explain the limitation. Do not silently fall back to one-off downloads because they cannot support resurfacing and revision.

### 6. Long-term Markdown contract

- One cognition maps to one Markdown file. The file receives a stable `yemai_id` at creation; title changes never change identity.
- Use a stable creation-time filename containing a safe title fragment and short identity suffix. Do not automatically rename the file when the cognition title evolves.
- Version the file contract with a Yemai schema field so future readers can reject unknown structures instead of guessing.
- Machine-readable frontmatter owns the Yemai identity, schema version, cognition type, status, creation/update timestamps, and stable source identifiers.
- Human-readable managed sections contain the current understanding, what changed, rationale, applicability boundary, unresolved questions, sources, and chronological evolution record.
- Each event has a stable event identity, event type, timestamp, source identity, before/after summary when relevant, reason, and resulting status.
- Initial event types are formed, supported, challenged, revised, and superseded. The first UI exposes formed, supported, challenged, and revised; the schema reserves superseded for later use.
- Initial cognition statuses are awaiting validation, currently accepted, contested, and superseded.
- Preserve unknown frontmatter keys and content outside Yemai-managed section markers. Before updating, reread the latest file and parse its current managed values; never overwrite from a stale in-memory projection.
- If stable identity, schema, or managed sections are duplicated or malformed, make that file read-only to Yemai and surface a repair issue. Do not auto-repair ambiguous Markdown.
- Write, close, reread, and validate a file before reporting persistence success or updating the derived index. A failed validation leaves the prior index entry active and exposes a retryable error.
- Confirmation is idempotent by candidate origin and `yemai_id`. Retrying after a local or remote failure updates the same file rather than creating another cognition.

### 7. Source and provenance boundaries

- A cognition stores source identity and a concise explanation, not a copy of the entire conversation or webpage.
- Source provenance can reference the source conversation, assistant message, page URL/title, and comparison page. Deleting the source conversation removes only the return link, not the cognition.
- URLs written to Markdown must be HTTP(S) and normalized using the existing distinction between display location and document identity.
- Web text, Agent text, frontmatter, and external Markdown edits remain untrusted input. Render them as text/Markdown through existing safe rendering boundaries and never inject them as HTML.

### 8. Derived local index

- Add a dedicated browser database table for derived cognition projections, file names, content fingerprints, last scan results, and weighted search documents. It is not a second knowledge source and can always be cleared and rebuilt.
- Keep the opaque directory handle in configuration metadata, not in machine backup content. Keep full cognition bodies in Markdown, not `WorkspaceState` or local backup entities.
- Scan only direct and nested Markdown files that contain a supported Yemai schema and valid `yemai_id`. Ignore ordinary Markdown completely.
- Detect duplicate identities and exclude all ambiguous copies from matching and writing until the user resolves them.
- Rebuild or incrementally refresh the index on initial successful connection, explicit refresh, successful write, Side Panel startup when permission is already granted, and a throttled stale-index check. Do not rescan on every render or streaming token.
- External edits are detected by file fingerprint and reparsed before a local comparison or write.

### 9. Local resurfacing policy

- Reuse the existing limited page manifest and local MiniSearch approach. Matching inputs are page title, site, limited overview, headings, and explicit current-page selections; complete page Markdown is unnecessary for ordinary matching.
- Weight cognition title and current understanding highest, followed by boundary, rationale, unresolved questions, and event summaries.
- Exclude unsupported statuses and the exact document identity that originally formed the cognition from ordinary resurfacing.
- Return at most three candidates after thresholding and deduplication. A weak result changes only the knowledge-entry state; a strong result may render an inline card; a potential conflict uses restrained conflict copy.
- “Why related” is generated from actual matched fields and terms. Local lexical overlap is evidence of relevance only, never proof of support or contradiction.
- Deferring or dismissing a page match changes only the current page-session presentation. It does not edit the cognition, status, score, or Markdown.
- Ordinary page matching performs no WorkOS request and uploads no cognition directory content.

### 10. User-initiated comparison analysis

- Start Agent comparison only after explicit user action. Before that action, the user can inspect the local cognition summary and provenance without network activity.
- Use a transient Agent-analysis context separate from the visible conversation's remote identity. Do not append hidden analysis messages to the current conversation or let comparison mutate its future Agent memory.
- Send only the target cognition's current managed fields, at most five recent event summaries, the current page identity, and the minimum current-page excerpt needed for comparison. Reuse the existing page snapshot length and trust boundaries.
- Do not send any other cognition, full directory listing, hidden tool output, internal reasoning, credentials, or unrelated conversation messages.
- Parse the result into an allow-listed comparison projection: relationship summary, supporting evidence, challenging evidence, possible boundary change, and suggested revision. Unknown fields and raw Agent events do not enter UI state.
- A failed, aborted, or malformed comparison creates no event and changes no Markdown. The user can retry or return to the article.

### 11. Resolution semantics

- “Keep current understanding” leaves current managed sections unchanged and appends a supported event containing the new source and user's reason.
- “Revise” requires a non-empty revised understanding or boundary, appends a revised event with before/after summaries, and updates the current managed sections.
- “Wait for evidence” preserves current understanding, appends a challenged event, records the unresolved question, and sets status to contested or awaiting validation as appropriate.
- File write and reread validation complete before the comparison workbench reports success. Only then does the result collapse into a compact inline receipt.
- Reopening the receipt reads the current indexed file and renders the evolution timeline; it does not rely on ephemeral workbench state.

### 12. A+ interface integration

- Render a cognition candidate immediately after its source assistant response. It should read as an extension of the conversation rather than a generic Agent form.
- After successful confirmation, replace the expanded form with a compact receipt containing title, persistence state, and an optional detail action.
- Expose current-page cognition state through the existing page identity/knowledge entry rather than adding a dashboard.
- Show the local relation as a small, explainable chain between current material and one cognition. Do not render a global force-directed graph.
- Use a modal lower workbench for comparison and revision, with a visible return action, focus containment, Escape handling, and focus restoration to the trigger.
- Workbench entrance/exit motion must communicate spatial continuity, remain short, and respect reduced-motion preference. Keyboard-triggered high-frequency actions do not animate.
- Completion returns to the original article or conversation and leaves a compact outcome with a “view evolution” action.
- At 300 to 430 pixels, actions can wrap vertically but the document, workbench, and relation chain must not create horizontal page scrolling.

### 13. Lifecycle, backup, and deletion semantics

- Independent cognition Markdown is not included in `YemaiBackupV1`; duplicating it into browser backup would create two competing recovery sources.
- Backup and settings copy must explicitly state that conversations/reading cards and the cognition directory have separate recovery responsibilities.
- Clearing local history, deleting a conversation, deleting a reading card, disconnecting a directory, or rebuilding the index never deletes cognition files.
- No cognition deletion UI is included in this slice. Users may delete files in their file manager or Obsidian; the next scan removes the derived projection.
- A missing or externally deleted file removes its index entry and future resurfacing after scan, while existing conversation receipts degrade to “file unavailable.”

### 14. Observability and truthful states

- Record only local operational counters and sanitized error categories needed for troubleshooting; do not log cognition text, page excerpts, file contents, absolute paths, credentials, or raw Agent payloads.
- Distinguish candidate proposed, locally persisted, comparison completed, and cognition revised. Never report “saved,” “updated,” or “indexed” before the corresponding durable action succeeds.
- Surface directory permission, parse, duplicate identity, write, reread validation, local index, transport, and comparison-shape failures with separate recovery actions.

### 15. Delivery order

- First prove directory selection, restorable access, write, reread, external edit, reconnect, and disconnect in a real Chrome Side Panel.
- Next implement the Markdown contract, derived index, and cognition-loop application service with in-memory and browser adapters.
- Then integrate the versioned Agent candidate protocol and inline confirmation receipt.
- Add local page matching and restrained resurfacing after files can be rebuilt into the index.
- Add the transient comparison adapter, focused workbench, and resolution writes last.
- Do not start global relationships, semantic embeddings, review scheduling, or full knowledge navigation before the vertical slice passes acceptance.

## Testing Decisions

- A good automated test enters through externally meaningful behavior, supplies commands and adapter outcomes, and asserts the resulting user-visible state plus durable Markdown/index effects. It does not assert private helper calls, component tree shape, CSS class names, parsing implementation order, or file-system API internals.
- The main automated Seam is the cognition-loop application service. An in-memory directory, deterministic Agent-analysis adapter, and real local index implementation exercise the complete sequence from candidate confirmation through resurfacing and revision.
- The core happy-path integration test must form a cognition, rebuild the index from its Markdown, match it against a different page, compare it, revise it, and verify that one stable file now contains the new current understanding and a traceable event history.
- Candidate tests cover recognized version/schema, malformed and generic A2UI fallthrough, completed-message eligibility, one-candidate-per-message, dismissal persistence, type-specific confirmation, empty confirmation rejection, and idempotent retry.
- Directory/Markdown contract tests cover stable identity and filename, safe filename generation, ordinary-file ignore behavior, nested managed files, unknown-field preservation, external edits before update, duplicate identities, malformed managed sections, write/re-read validation failure, deleted files, and index rebuild.
- Resurfacing tests cover weighting, threshold levels, a maximum of three results, source-page exclusion, duplicate suppression, human-readable match reasons, unsupported statuses, and the guarantee that matching never invokes the Agent adapter.
- Comparison tests cover minimal context selection, transient analysis identity, structured-result allow-listing, abort/malformed-result no-op behavior, and keep/revise/wait resolution semantics.
- Lifecycle tests prove that disconnect, local-history clearing, conversation deletion, reading-card deletion, and index clearing do not invoke directory deletion.
- Reuse existing testing prior art: repository tests with isolated databases, workspace-storage integration tests for durable sequencing and retry, reading-card tests for stable provenance and source deletion, Agent-decision tests for interrupt lifecycle, and action-semantic tests for truthful feedback.
- Do not add broad React snapshots. Pure presentation helpers may receive focused tests only when they encode accessibility or state semantics that cannot be covered through the application Seam.
- Real Chrome manual acceptance is mandatory for directory picker behavior, persisted permission/reconnect, external Obsidian edits, Side Panel close/reopen, actual file contents, focus trapping/restoration, reduced motion, and widths from 300 to 430 pixels.
- Manual acceptance must exercise all three comparison outcomes and a failed write. It must verify that success is withheld until file reread validation completes.
- Run the existing TypeScript check, full Vitest suite, production extension build, and current release checklist regression before calling the feature implemented.
- Product validation remains separate from implementation acceptance: during two weeks of personal use, form at least ten actively confirmed cognitions, observe three explained reencounters, revise or overturn at least one cognition, and record at least one moment where Yemai surfaced an understanding the user would otherwise have missed.

## Out of Scope

- Importing existing Obsidian notes or treating them as cognition.
- Managing files without a supported Yemai cognition identity.
- Bidirectional synchronization with Obsidian, cloud storage, or another device.
- Automatic editing, renaming, moving, or deleting of arbitrary Markdown files.
- A global knowledge graph, force-directed relationship map, theme dashboard, or permanent split-pane knowledge workspace.
- Automatic topic summary files or a second maintained knowledge representation.
- Semantic embeddings, vector databases, full local RAG, or cloud indexing of the cognition directory in the first slice.
- Automatic injection of resurfaced cognition into ordinary Agent requests.
- Fully automatic cognition saving without a user confirmation action.
- A candidate after every Agent answer or batch generation of cognition from old conversations.
- Importing reading cards as cognition or renaming reading cards to cognition.
- Spaced repetition, quizzes, memory scores, scheduled reviews, or notification-driven learning.
- Multiple users, collaboration, accounts, remote history synchronization, or cognition sharing.
- Cognition deletion, merging, manual taxonomy management, or bulk editing UI.
- Replacing the current chat, page extraction, workspace, WorkOS transport, or local backup architecture.
- Expanding platform-specific extraction, attachment formats, batch links, or remote WorkOS history as part of this feature.
- Claiming that local relevance proves support, contradiction, correctness, or user belief.

## Further Notes

- Use the stable domain language throughout implementation: material, reading card, cognition candidate, cognition, cognition event, cognition reencounter, and cognition directory are distinct objects.
- The independent Markdown directory ADR remains authoritative. Any implementation that makes browser IndexedDB the only copy of cognition, imports an existing vault, silently overwrites ordinary Markdown, or creates a second maintained source of truth requires a new architectural decision.
- The A+ prototype is decision evidence, not production code. Reuse its interaction hierarchy and state transitions, but integrate through existing React, repository, Agent-decision, safe-rendering, and accessibility conventions.
- Directory permission persistence is a hard feasibility gate. If real Chrome testing cannot reliably reconnect from the Side Panel, stop before implementing matching and comparison and revise the storage approach explicitly.
- Candidate quality and reencounter usefulness are product risks, not reasons to expand scope. If two-week validation produces files but no meaningful future influence, do not compensate by building graphs, tags, or more automation.
- This specification is published as GitHub Issue #3 with only the `ready-for-agent` triage label.
