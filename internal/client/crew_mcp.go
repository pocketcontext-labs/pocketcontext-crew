package client

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"net/http"
)

type crewRead struct {
	Collection       string  `json:"collection" jsonschema:"agents, buckets, notes, note_revisions, tasks, events, reviews, webhook_configs, webhook_deliveries, webhook_attempts, or webhook_routing"`
	ID               string  `json:"id,omitempty"`
	Parent           string  `json:"parent,omitempty" jsonschema:"Bucket for notes, note for revisions, task for reviews, record for events, config for webhook_deliveries, delivery for webhook_attempts"`
	Query            string  `json:"query,omitempty"`
	Archived         bool    `json:"archived,omitempty"`
	Offset           int     `json:"offset,omitempty"`
	ResponsibleAgent *string `json:"responsible_agent,omitempty" jsonschema:"Buckets only: agent ID or unique exact name; empty string selects unassigned buckets."`
}

type crewWrite struct {
	IdempotencyKey   string         `json:"idempotency_key,omitempty" jsonschema:"Persistent retry key, required for agent.ensure and webhook.create/test/catch_up; supported for all webhook operations. Same key/input returns the original result; changed input conflicts."`
	Action           string         `json:"action" jsonschema:"agent.create/update/ensure, bucket.create/update/assign, note.create/update/restore, task.create/update/claim/comment, review.request/withdraw; webhook.create/update/enable/disable/test/retry/catch_up/routing.update. Owner decisions, bucket archival and agent deactivation are unavailable."`
	ID               string         `json:"id,omitempty"`
	ExpectedRevision int            `json:"expected_revision,omitempty"`
	ReportedAgent    string         `json:"reported_agent" jsonschema:"Your agent name; reported attribution, not verified identity"`
	Reason           string         `json:"reason,omitempty"`
	Data             map[string]any `json:"data" jsonschema:"Action fields. bucket.assign uses agent (ID, unique exact name, null or empty string to clear); bucket.create/update use responsible_agent with the same values. Updates and assignments require expected_revision. Notes use bucket,title,body,links,archived. Tasks use title,description,assigned_agent,labels,status,draft,links,archived,readiness (waiting default or ready),waiting_reason. Pending reviews suppress wakes. task.claim optionally takes expected_generation for an atomic ready claim. webhook.create uses agent,url,adapter (crew-v1 with bearer authentication and durable receiver conformance),subscriptions (reassigned,assigned,unassigned,review_outcome,reopened,ready,created,catch_up),write-only secret; update uses url,adapter,subscriptions,secret or clear_secret. enable/disable/test use config id and empty data. retry uses delivery id and data.config_revision. catch_up uses config id and data.tasks [{id,expected_revision}]. routing.update uses data.triage_agent. agent.ensure uses name,brief and optional agent ID. review.request uses task id and empty data. note.restore uses revision_id."`
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
		return c.Must("POST", "/api/crew/agent-write", map[string]any{"idempotency_key": a.IdempotencyKey, "action": a.Action, "id": a.ID, "expected_revision": a.ExpectedRevision, "reported_agent": a.ReportedAgent, "reason": a.Reason, "data": a.Data})
	})
}
