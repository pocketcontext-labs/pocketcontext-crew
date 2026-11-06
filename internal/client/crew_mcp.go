package client

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"net/http"
)

type crewRead struct {
	mcpSpace
	Collection string `json:"collection" jsonschema:"agents, buckets, notes, note_revisions, tasks, events, or reviews"`
	ID         string `json:"id,omitempty"`
	Parent     string `json:"parent,omitempty" jsonschema:"Bucket for notes, note for revisions, task for reviews, record for events"`
	Query      string `json:"query,omitempty"`
	Archived   bool   `json:"archived,omitempty"`
	Offset     int    `json:"offset,omitempty"`
}
type crewWrite struct {
	mcpSpace
	Action           string         `json:"action" jsonschema:"agent.create/update, bucket.create/update, note.create/update/restore, task.create/update/claim/comment, review.request/withdraw. Owner decisions and bucket archive/reassignment are unavailable."`
	ID               string         `json:"id,omitempty"`
	ExpectedRevision int            `json:"expected_revision,omitempty"`
	ReportedAgent    string         `json:"reported_agent" jsonschema:"Your agent name; reported attribution, not verified identity"`
	Reason           string         `json:"reason,omitempty"`
	Data             map[string]any `json:"data" jsonschema:"Action fields. Notes use bucket,title,body,links,archived. Tasks use title,description,assigned_agent,labels,status,draft,links,archived. Updates require expected_revision. review.request uses task id and empty data. note.restore uses revision_id."`
}

func addCrewMCPTools(s *mcp.Server, api http.Handler) {
	addMCPTool(s, api, "crew_read", "Read or search Crew memory and work. Archived notes/buckets are excluded by default. Follow next_offset when has_more. Read note_revisions for history and reviews for exact draft snapshots.", true, func(c *Client, a crewRead) (any, error) {
		return c.Must("POST", "/api/crew/read", map[string]any{"collection": a.Collection, "id": a.ID, "parent": a.Parent, "query": a.Query, "archived": a.Archived, "offset": a.Offset})
	})
	addMCPTool(s, api, "crew_write", "Create and update Crew memory/tasks or request human review. Cannot record approval decisions. Bucket ownership is a behavioral convention. On conflict reread and reassess. Updating a draft withdraws its pending review; approval never executes an external action.", false, func(c *Client, a crewWrite) (any, error) {
		return c.Must("POST", "/api/crew/agent-write", map[string]any{"action": a.Action, "id": a.ID, "expected_revision": a.ExpectedRevision, "reported_agent": a.ReportedAgent, "reason": a.Reason, "data": a.Data})
	})
}
