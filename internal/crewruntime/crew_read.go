package crewruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/crewread/searchread"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/crewread/sqlread"
)

// SQL limits. The byte limit stays far below the MCP result limit.
const (
	crewSQLTimeout  = 2 * time.Second
	crewSQLMaxRows  = 1000
	crewSQLMaxBytes = 1 << 20
)

// crewSQLViews is the complete SQL allowlist: stable view names over explicit
// columns. Every column here is already returned by crew_read for the same
// collection. Deliberately excluded (never add without a security review):
//   - webhook_configs.url and secret_ciphertext: owner-browser-only receiver
//     URL and encrypted credential (crew_read redacts both);
//   - webhook_executions worker_id, dispatch_worker_id, fence, dispatch_fence
//     and webhook_bridges.wake_worker_id: fencing proof handles, not needed
//     for reporting (proofs come from execution operations and crew_read);
//   - crew_webhook_idempotency (hidden fingerprints, replay results that may
//     hold legacy receiver URLs), users and every other auth collection,
//     PocketBase internal tables (_*), OAuth state (outside this database)
//     and retired knowledge collections.
//
// SQL sees archived records; callers filter archived explicitly.
var crewSQLViews = func() []sqlread.View {
	common := []string{"revision", "created", "updated"}
	archive := []string{"archived", "archived_at", "archived_by"}
	cols := func(lists ...[]string) []string {
		out := []string{"id"}
		for _, l := range lists {
			out = append(out, l...)
		}
		return append(out, common...)
	}
	f := strings.Fields
	return []sqlread.View{
		{Name: "agents", Table: "crew_agents", Columns: cols(f("name brief"), archive)},
		{Name: "buckets", Table: "crew_buckets", Columns: cols(f("name purpose responsible_agent"), archive)},
		{Name: "notes", Table: "crew_notes", Columns: cols(f("bucket title body links"), archive)},
		{Name: "note_revisions", Table: "crew_note_revisions", Columns: cols(f("note title body links actor reported_agent reason"))},
		{Name: "tasks", Table: "crew_tasks", Columns: cols(f("title description assigned_agent created_by_agent labels status draft links readiness waiting_reason wake_generation execution_required_generation bot_handoffs handoff_limited comment_wake_generation comment_wake_event"), archive)},
		{Name: "events", Table: "crew_events", Columns: cols(f("parent action body actor reported_agent reason changes"))},
		{Name: "reviews", Table: "crew_reviews", Columns: cols(f("task draft status decision_note decided_by decided_at requested_by reported_agent"))},
		{Name: "webhook_configs", Table: "crew_webhook_configs", Columns: cols(f("agent adapter subscriptions enabled destination_version scope sync_status routine_ref dispatch_mode instructions role_instructions reporting_instructions previous_instructions instruction_revision applied_revision managed_hash applied_hash test_event_id runtime_event_id runtime_epoch runtime_context runtime_reported_at runtime_destination_version runtime_instruction_revision runtime_native_handoff runtime_execution_protocol runtime_parent_wake"))},
		{Name: "webhook_mappings", Table: "crew_webhook_mappings", Columns: cols(f("agent bot_ref bot_name"))},
		{Name: "webhook_routing", Table: "crew_webhook_routing", Columns: cols(f("singleton instance_id epoch triage_agent paused max_bot_handoffs"))},
		{Name: "webhook_deliveries", Table: "crew_webhook_deliveries", Columns: cols(f("config task agent target_kind generation epoch event_id payload state destination_version attempts retry_cycle next_attempt_at deadline_at lease_until last_error accepted_at"))},
		{Name: "webhook_attempts", Table: "crew_webhook_attempts", Columns: cols(f("delivery phase attempt retry_cycle status_code error_code started_at finished_at"))},
		{Name: "webhook_executions", Table: "crew_webhook_executions", Columns: cols(f("event_id delivery task agent config epoch generation destination_version mapping_revision state outcome_code dispatch_attempts lease_until handoff_at handoff_prepared_at handoff_deadline_at handoff_message_ref handoff_capability_reported dispatch_started_at acquired_at completed_at"))},
		{Name: "webhook_bridges", Table: "crew_webhook_bridges", Columns: cols(f("event_id delivery config epoch state dispatch_mode event_type task_id generation instruction_revision destination_version mapping_revision recipient_agent recipient_bot_ref message_ref wake_prepared_at parent_received_at send_prepared_at send_reported_at recipient_received_at deadline_at parent_native_handoff parent_execution_protocol recipient_automatic"))},
	}
}()

// mainDatabasePath names the file behind the application's own connection:
// the private working copy in the cache, never the synced project database.
func mainDatabasePath(app core.App) (string, error) {
	var path string
	if err := app.ConcurrentDB().NewQuery("SELECT file FROM pragma_database_list WHERE name='main'").Row(&path); err != nil {
		return "", err
	}
	if path == "" {
		return "", errors.New("crew SQL requires a file database")
	}
	return path, nil
}

// registerCrewReads adds the authenticated Go read routes. Ranked search reads
// through the application's own database connection pool. SQL uses separate
// read-only connections (mode=ro, query_only, authorizer) to the same private
// working copy, because its authorizer must own each connection. Nothing here writes.
func registerCrewReads(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		pool, ok := app.ConcurrentDB().(*dbx.DB)
		if !ok {
			return errors.New("crew search requires the application database pool")
		}
		search := searchread.New(pool.DB(), searchread.Config{})
		path, err := mainDatabasePath(app)
		if err != nil {
			return err
		}
		engine, err := sqlread.New(path, sqlread.Config{Views: crewSQLViews, Timeout: crewSQLTimeout, MaxRows: crewSQLMaxRows, MaxBytes: crewSQLMaxBytes})
		if err != nil {
			search.Close()
			return fmt.Errorf("crew SQL reads: %w", err)
		}
		app.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
			defer search.Close()
			defer engine.Close()
			return te.Next()
		})
		e.Router.GET("/api/crew/schema", func(re *core.RequestEvent) error {
			return crewSchema(re, engine)
		}).Bind(apis.RequireAuth("users"))
		e.Router.POST("/api/crew/query", func(re *core.RequestEvent) error {
			return crewQuery(re, engine)
		}).Bind(apis.RequireAuth("users"))
		e.Router.POST("/api/crew/search", func(re *core.RequestEvent) error {
			return crewSearch(re, search)
		}).Bind(apis.RequireAuth("users"))
		return e.Next()
	})
}

// decodeCrewBody accepts exactly one bounded JSON object without unknown fields.
func decodeCrewBody(re *core.RequestEvent, limit int64, target any) error {
	re.Request.Body = http.MaxBytesReader(re.Response, re.Request.Body, limit)
	decoder := json.NewDecoder(re.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("expected one JSON object")
	}
	return nil
}

func crewSearch(re *core.RequestEvent, search *searchread.Engine) error {
	re.Response.Header().Set("Cache-Control", "no-store")
	var body struct {
		Query       string   `json:"query"`
		Collections []string `json:"collections"`
		Limit       int      `json:"limit"`
		Offset      int      `json:"offset"`
		Archived    bool     `json:"archived"`
		Generation  string   `json:"generation"`
	}
	if err := decodeCrewBody(re, 65536, &body); err != nil {
		return re.BadRequestError("Expected JSON with query and optional collections, limit, offset, archived and generation", nil)
	}
	result, err := search.Search(re.Request.Context(), searchread.Request{Query: body.Query, Collections: body.Collections, Limit: body.Limit, Offset: body.Offset, Archived: body.Archived, Generation: body.Generation})
	switch {
	case err == nil:
		for i := range result.Items {
			hit := &result.Items[i]
			link, err := crewRecordLink(re.App, hit.Collection, hit.ID, hit.Title)
			if err != nil {
				return re.InternalServerError("Search failed", nil)
			}
			hit.Path, hit.URL = link["path"], link["url"]
		}
		return re.JSON(http.StatusOK, result)
	case errors.Is(err, searchread.ErrInvalidQuery):
		return re.BadRequestError(err.Error(), nil)
	case errors.Is(err, searchread.ErrGenerationChanged):
		return re.JSON(http.StatusConflict, map[string]any{"status": 409, "message": err.Error(), "data": map[string]any{"generation": result.Generation}})
	case errors.Is(err, searchread.ErrIndexLimit):
		return re.JSON(http.StatusRequestEntityTooLarge, map[string]any{"status": 413, "message": "Search index exceeds its size limit; use crew_read filters", "data": map[string]any{}})
	case errors.Is(err, context.DeadlineExceeded):
		return re.JSON(http.StatusRequestTimeout, map[string]any{"status": 408, "message": "Search deadline exceeded", "data": map[string]any{}})
	default:
		re.App.Logger().Warn("crew search failed", "error", err.Error())
		return re.InternalServerError("Search failed", nil)
	}
}

func crewSchema(re *core.RequestEvent, engine *sqlread.Engine) error {
	re.Response.Header().Set("Cache-Control", "no-store")
	tables, err := engine.Schema(re.Request.Context())
	if err != nil {
		return re.InternalServerError("Cannot read Crew SQL schema", nil)
	}
	return re.JSON(http.StatusOK, map[string]any{
		"tables": tables,
		"limits": map[string]int{"timeout_ms": int(crewSQLTimeout / time.Millisecond), "max_rows": crewSQLMaxRows, "max_bytes": crewSQLMaxBytes, "max_sql_bytes": 65536},
		"notes": []string{
			"Read-only SELECT/WITH over these views only; one statement per request.",
			"SQL sees archived records: filter archived explicitly (notes are also archived when their bucket is).",
			"JSON columns (links, labels, changes, payload, subscriptions) are text; use json_each or ->>.",
			"Timestamps are UTC text 'YYYY-MM-DD HH:MM:SS.sssZ'. Booleans are 0/1.",
			"Webhook URLs, credentials and execution fencing handles are not readable.",
		},
	})
}

func crewQuery(re *core.RequestEvent, engine *sqlread.Engine) error {
	re.Response.Header().Set("Cache-Control", "no-store")
	var body struct {
		SQL string `json:"sql"`
	}
	if err := decodeCrewBody(re, 131072, &body); err != nil {
		return re.BadRequestError("Expected JSON with sql", nil)
	}
	result, err := engine.Query(re.Request.Context(), body.SQL)
	if err != nil {
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			return re.JSON(http.StatusRequestTimeout, map[string]any{"status": 408, "message": "SQL deadline exceeded; narrow the query", "data": map[string]any{}})
		case errors.Is(err, sqlread.ErrBusy):
			re.Response.Header().Set("Retry-After", "1")
			return re.JSON(http.StatusServiceUnavailable, map[string]any{"status": 503, "message": "Database busy; retry the query", "data": map[string]any{}})
		}
		return re.BadRequestError("SQL query rejected: "+err.Error(), nil)
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return re.InternalServerError("Cannot encode query result", nil)
	}
	if len(payload) > crewSQLMaxBytes {
		return re.JSON(http.StatusRequestEntityTooLarge, map[string]any{"status": 413, "message": "Encoded result exceeds max_bytes; select fewer or smaller fields", "data": map[string]any{}})
	}
	return re.Blob(http.StatusOK, "application/json", payload)
}
