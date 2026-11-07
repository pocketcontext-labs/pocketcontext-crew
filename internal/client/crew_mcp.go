package client

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"net/http"
)

type crewRead struct {
	Collection       string  `json:"collection" jsonschema:"agents, buckets, notes, note_revisions, tasks, events, reviews, webhook_configs, webhook_deliveries, webhook_attempts, webhook_routing, webhook_mappings, or webhook_executions"`
	ID               string  `json:"id,omitempty"`
	Parent           string  `json:"parent,omitempty" jsonschema:"Bucket for notes, note for revisions, task for reviews, record for events, config for webhook_deliveries, delivery for webhook_attempts"`
	Query            string  `json:"query,omitempty"`
	Archived         bool    `json:"archived,omitempty"`
	Offset           int     `json:"offset,omitempty"`
	ResponsibleAgent *string `json:"responsible_agent,omitempty" jsonschema:"Buckets only: agent ID or unique exact name; empty string selects unassigned buckets."`
}

type crewWrite struct {
	Execution        map[string]any `json:"execution,omitempty" jsonschema:"Task writes under an unresolved execution require proof {id,worker_id,fence}. This does not grant separate bot identity."`
	IdempotencyKey   string         `json:"idempotency_key,omitempty" jsonschema:"Persistent retry key, required for execution mutations and fenced task.comment, agent.ensure and webhook.test/catch_up; supported for all webhook operations. Same key/input returns the original result; changed input conflicts."`
	Action           string         `json:"action" jsonschema:"agent.create/update/ensure, bucket.create/update/assign, note.create/update/restore, task.create/update/claim/comment, review.request/withdraw; webhook.integration.update/instructions.sync/mapping.update/enable/disable/test/retry/catch_up/routing.update. execution.validate/test_ack/acquire/renew/handoff/dispatched/start/complete. Owner decisions, execution.recover, credential entry, bucket archival and agent deactivation are unavailable."`
	ID               string         `json:"id,omitempty"`
	ExpectedRevision int            `json:"expected_revision,omitempty"`
	ReportedAgent    string         `json:"reported_agent" jsonschema:"Your agent name; reported attribution, not verified identity"`
	Reason           string         `json:"reason,omitempty"`
	Data             map[string]any `json:"data" jsonschema:"Action fields. bucket.assign uses agent (ID, unique exact name, null or empty string to clear); bucket.create/update use responsible_agent with the same values. Updates and assignments require expected_revision. Notes use bucket,title,body,links,archived. Tasks use title,description,assigned_agent,labels,status,draft,links,archived,readiness (waiting default or ready),waiting_reason. Pending reviews suppress wakes. task.claim optionally takes expected_generation for an atomic ready claim. webhook.integration.update uses agent (dispatcher ID), instructions, subscriptions; changing dispatcher clears credentials. webhook.instructions.sync uses instruction_revision,routine_ref,status (reported or verified), instructions for verified readback equality. webhook.mapping.update uses agent,bot_ref with expected_revision (0 to create). URL and secret are owner-browser-only; never request them in chat or MCP. enable/disable/test use config id and empty data. retry uses delivery id and data.config_revision. catch_up uses config id and data.tasks [{id,expected_revision}]. routing.update uses data.triage_agent. execution.validate uses event_id,epoch,generation; test_ack uses event_id,epoch and performs no task action. execution.acquire uses event_id,epoch,generation,phase (dispatch or work),worker_id, optional lease_seconds (30..900). Other execution actions use execution id/expected_revision with worker_id,fence; renew optionally lease_seconds; complete outcome (completed or failed), optional mark_done and task_revision for atomic completion. All execution mutations and task.comment with execution proof require idempotency_key; execution.validate always rechecks current state. Expired/ambiguous work requires owner recovery; never silently repeat side effects. agent.ensure uses name,brief and optional agent ID. review.request uses task id and empty data. note.restore uses revision_id."`
}

func addCrewMCPTools(s *mcp.Server, api http.Handler) {
	addMCPTool(s, api, "crew_read", "Read or search Crew memory and work. Archived notes/buckets are excluded by default. Follow next_offset when has_more. Buckets retain responsible_agent IDs and include responsible_agent_details (id/name or null). Read note_revisions for history and reviews for exact draft snapshots.", true, func(c *Client, a crewRead) (any, error) {
		body := map[string]any{"collection": a.Collection, "id": a.ID, "parent": a.Parent, "query": a.Query, "archived": a.Archived, "offset": a.Offset}
		if a.ResponsibleAgent != nil {
			body["responsible_agent"] = *a.ResponsibleAgent
		}
		return c.Must("POST", "/api/crew/read", body)
	})
	addMCPTool(s, api, "crew_write", "Create and update Crew memory/tasks or request human review. Cannot record approval decisions. Bucket ownership is a behavioral convention. On conflict reread and reassess. Updating a draft withdraws its pending review; approval never executes an external action.", false, func(c *Client, a crewWrite) (any, error) {
		return c.Must("POST", "/api/crew/agent-write", map[string]any{"execution": a.Execution, "idempotency_key": a.IdempotencyKey, "action": a.Action, "id": a.ID, "expected_revision": a.ExpectedRevision, "reported_agent": a.ReportedAgent, "reason": a.Reason, "data": a.Data})
	})
}
