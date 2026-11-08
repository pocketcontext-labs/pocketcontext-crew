package client

import (
	"errors"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type crewRead struct {
	Collection       string   `json:"collection" jsonschema:"capabilities (versioned operation schemas), agents, buckets, notes, note_revisions, tasks, events, reviews, webhook_configs, webhook_deliveries, webhook_attempts, webhook_routing, webhook_mappings, webhook_bridges, or webhook_executions"`
	ID               string   `json:"id,omitempty"`
	Parent           string   `json:"parent,omitempty" jsonschema:"Bucket for notes, note for revisions, task for reviews, record for events, config for webhook_deliveries/webhook_bridges, delivery for webhook_attempts"`
	Query            string   `json:"query,omitempty"`
	Archived         bool     `json:"archived,omitempty"`
	Offset           int      `json:"offset,omitempty"`
	ResponsibleAgent *string  `json:"responsible_agent,omitempty" jsonschema:"Buckets only: agent ID or unique exact name; empty string selects unassigned buckets."`
	Limit            int      `json:"limit,omitempty" jsonschema:"Page size 1-100 (default 100). next_offset advances by this size."`
	Fields           []string `json:"fields,omitempty" jsonschema:"Return only these top-level fields (id and revision are always included), e.g. [\"title\",\"status\"]. Unknown or redacted fields are rejected."`
	AssignedAgent    *string  `json:"assigned_agent,omitempty" jsonschema:"Tasks only: agent ID or unique exact name; empty string selects unassigned tasks."`
	Status           []string `json:"status,omitempty" jsonschema:"Tasks only: one or more of todo, in_progress, needs_review, done."`
	Readiness        string   `json:"readiness,omitempty" jsonschema:"Tasks only: waiting or ready."`
	Label            string   `json:"label,omitempty" jsonschema:"Tasks only: tasks carrying this exact label."`
	ChangedSince     string   `json:"changed_since,omitempty" jsonschema:"RFC3339 timestamp; records updated at or after it."`
}

type crewSearch struct {
	Query       string   `json:"query" jsonschema:"Words to find (all must match; append * for a prefix). Ranked by relevance (BM25)."`
	Collections []string `json:"collections,omitempty" jsonschema:"notes and/or tasks (default both)."`
	Limit       int      `json:"limit,omitempty" jsonschema:"Hits per page 1-50 (default 10)."`
	Offset      int      `json:"offset,omitempty"`
	Archived    bool     `json:"archived,omitempty" jsonschema:"Search only archived items (archived notes, notes in archived buckets, archived tasks), like crew_read."`
	Generation  string   `json:"generation,omitempty" jsonschema:"When following next_offset, pass the generation from the first page; a conflict means content changed, so restart."`
}

type crewQuery struct {
	SQL string `json:"sql" jsonschema:"One read-only SELECT/WITH statement over the crew_schema views. SQL sees archived records: filter archived explicitly. At most 1000 rows and 1 MiB per result."`
}

type crewWrite struct {
	Execution        map[string]any `json:"execution,omitempty" jsonschema:"Governed task writes require proof even before first acquisition {id,worker_id,fence}. This does not grant separate bot identity."`
	IdempotencyKey   string         `json:"idempotency_key,omitempty" jsonschema:"Persistent retry key, required for bridge/execution mutations and fenced task.comment, agent.ensure and webhook.test/catch_up; supported for all webhook operations. Replays reconcile guarded wake/send/acquisition steps without granting permission again; changed input conflicts."`
	Action           string         `json:"action" jsonschema:"agent.create/update/ensure, bucket.create/update/assign, note.create/update/restore, task.create/update/claim/comment, review.request/withdraw; webhook.integration.update/instructions.sync/runtime.report/mapping.update/enable/disable/test/retry/catch_up/routing.update; webhook.bridge.prepare/parent/sent/ack. execution.validate/test_ack/begin/acquire/renew/handoff/dispatched/start/complete. Owner decisions, execution.recover, credential entry, bucket archival and agent deactivation are unavailable."`
	ID               string         `json:"id,omitempty"`
	ExpectedRevision int            `json:"expected_revision,omitempty"`
	ReportedAgent    string         `json:"reported_agent" jsonschema:"Your agent name; reported attribution, not verified identity"`
	Reason           string         `json:"reason,omitempty"`
	Data             map[string]any `json:"data" jsonschema:"First read collection capabilities for complete operation/result schemas and the current protocol version. Cached clients can put idempotency_key and execution inside data._crew instead of top-level fields; all checks remain identical. execution.begin atomically validates/acquires and returns next_step. Action fields. bucket.assign uses agent (ID, unique exact name, null or empty string to clear); bucket.create/update use responsible_agent with the same values. Updates and assignments require expected_revision. Notes use bucket,title,body,links,archived. Tasks use title,description,assigned_agent,labels,status,draft,links,archived,readiness (waiting default or ready),waiting_reason. Pending reviews suppress wakes. task.claim optionally takes expected_generation for an atomic ready claim. webhook.integration.update uses agent (dispatcher ID), dispatch_mode (native or parent_bridge), instructions, subscriptions; changing dispatcher clears credentials. webhook.instructions.sync uses instruction_revision,routine_ref,status (reported or verified), instructions for verified managed-block readback equality. webhook.mapping.update uses agent,bot_ref with expected_revision (0 to create). URL and secret are owner-browser-only; never request them in chat or MCP. enable/disable use config id and empty data. webhook.test optionally selects recipient_agent_id for an explicit diagnostic handoff without task work. Read capabilities for revision-checked webhook.bridge operations; they durably guard parent wakes and diagnostic sends, separately record parent/recipient evidence, and never authorize task work while delivery is disabled. retry uses delivery id and data.config_revision. catch_up uses config id and data.tasks [{id,expected_revision}]. routing.update uses data.triage_agent; max_bot_handoffs is owner-only. Tasks stopped by the bot handoff limit (handoff_limited) can only be set Ready by the owner. execution.validate uses event_id,epoch,generation; test_ack uses event_id,epoch and performs no task action. execution.acquire uses event_id,epoch,generation,phase (dispatch or work),worker_id, optional lease_seconds (30..900). Other execution actions use execution id/expected_revision with worker_id,fence; renew optionally lease_seconds; complete outcome (completed or failed), optional mark_done and task_revision for atomic completion. All bridge/execution mutations and task.comment with execution proof require idempotency_key; execution.validate always rechecks current state. Expired/ambiguous work requires owner recovery; never silently repeat side effects. agent.ensure uses name,brief and optional agent ID. review.request uses task id and empty data. note.restore uses revision_id."`
}

// Crew routes shared by the MCP tools and the CLI work commands. Writes always
// use the agent route: owner decisions, bucket archival and agent deactivation
// stay with the owner path.
const (
	crewReadRoute   = "/api/crew/read"
	crewSearchRoute = "/api/crew/search"
	crewSchemaRoute = "/api/crew/schema"
	crewQueryRoute  = "/api/crew/query"
	crewWriteRoute  = "/api/crew/agent-write"
	crewSQLLimit    = 65536
)

// errCrewSQLTooLong is reported before any request; MCP and the CLI classify it
// in their own error styles.
var errCrewSQLTooLong = errors.New("SQL exceeds 64 KiB")

// crewRequest is one API call built from a tool or command input.
type crewRequest struct {
	method, path string
	body         any
}

func (r crewRequest) send(c *Client) (any, error) { return c.Must(r.method, r.path, r.body) }

func (a crewRead) request() crewRequest {
	body := map[string]any{"collection": a.Collection, "id": a.ID, "parent": a.Parent, "query": a.Query, "archived": a.Archived, "offset": a.Offset}
	if a.ResponsibleAgent != nil {
		body["responsible_agent"] = *a.ResponsibleAgent
	}
	if a.AssignedAgent != nil {
		body["assigned_agent"] = *a.AssignedAgent
	}
	if a.Limit != 0 {
		body["limit"] = a.Limit
	}
	if a.Fields != nil {
		body["fields"] = a.Fields
	}
	if a.Status != nil {
		body["status"] = a.Status
	}
	for k, v := range map[string]string{"readiness": a.Readiness, "label": a.Label, "changed_since": a.ChangedSince} {
		if v != "" {
			body[k] = v
		}
	}
	return crewRequest{"POST", crewReadRoute, body}
}

func (a crewSearch) request() crewRequest {
	body := map[string]any{"query": a.Query, "offset": a.Offset, "archived": a.Archived}
	if a.Collections != nil {
		body["collections"] = a.Collections
	}
	if a.Limit != 0 {
		body["limit"] = a.Limit
	}
	if a.Generation != "" {
		body["generation"] = a.Generation
	}
	return crewRequest{"POST", crewSearchRoute, body}
}

func crewSchemaRequest() crewRequest { return crewRequest{"GET", crewSchemaRoute, nil} }

func (a crewQuery) request() (crewRequest, error) {
	if len(a.SQL) > crewSQLLimit {
		return crewRequest{}, errCrewSQLTooLong
	}
	return crewRequest{"POST", crewQueryRoute, map[string]any{"sql": a.SQL}}, nil
}

func (a crewWrite) request() crewRequest {
	return crewRequest{"POST", crewWriteRoute, map[string]any{"execution": a.Execution, "idempotency_key": a.IdempotencyKey, "action": a.Action, "id": a.ID, "expected_revision": a.ExpectedRevision, "reported_agent": a.ReportedAgent, "reason": a.Reason, "data": a.Data}}
}

func addCrewMCPTools(s *mcp.Server, api http.Handler) {
	addMCPTool(s, api, "crew_read", "Read capabilities first for versioned operation schemas and legacy-envelope compatibility (wake runs use id \"execution\" for the compact execution subset and may skip rereading when they already hold the payload's capabilities_digest); then read Crew memory and work. Keep reads compact: filter tasks (assigned_agent, status, readiness, label), use changed_since, a small limit and fields (for example [\"title\",\"status\"]); read one record by id with fields; request full records only when you need their bodies. Use crew_search to find notes/tasks by topic. Archived notes/buckets are excluded by default. Follow next_offset when has_more. Buckets retain responsible_agent IDs and include responsible_agent_details (id/name or null). Read note_revisions for history and reviews for exact draft snapshots.", true, func(c *Client, a crewRead) (any, error) {
		return a.request().send(c)
	})
	addMCPTool(s, api, "crew_search", "Find notes and tasks by topic with ranked full-text search. Returns compact hits (collection, id, title, short excerpt, revision, updated, bucket or status/assignment, score), not full bodies. Then crew_read the chosen id with fields, and read full records only when needed. Follow next_offset with the returned generation; archived items require archived: true. Webhook data is never searched.", true, func(c *Client, a crewSearch) (any, error) {
		return a.request().send(c)
	})
	addMCPTool(s, api, "crew_schema", "Not needed for wake or execution protocol steps. Read the SQL views (agents, buckets, notes, note_revisions, tasks, events, reviews and non-secret webhook tables), their columns and query limits before using crew_query.", true, func(c *Client, _ struct{}) (any, error) {
		return crewSchemaRequest().send(c)
	})
	addMCPTool(s, api, "crew_query", "Run bounded read-only SQL for counts, joins, aggregates and history across Crew records (for example tasks grouped by status and assigned_agent). Prefer crew_read filters or crew_search for ordinary lookups. SQL includes archived records, so filter archived explicitly; notes in archived buckets are archived too. Webhook URLs, credentials and fencing handles are not readable.", true, func(c *Client, a crewQuery) (any, error) {
		r, err := a.request()
		if err != nil {
			return nil, mcpDiagnosticError("limit_exceeded", err.Error())
		}
		return r.send(c)
	})
	addMCPTool(s, api, "crew_write", "Create and update Crew memory/tasks or request human review. Cannot record approval decisions. Bucket ownership is a behavioral convention. On conflict reread and reassess. Updating a draft withdraws its pending review; approval never executes an external action.", false, func(c *Client, a crewWrite) (any, error) {
		return a.request().send(c)
	})
}
