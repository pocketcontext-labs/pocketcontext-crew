package crewruntime

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Crew 0.23.0: the task release column becomes release-<value> labels.
func TestTaskReleaseMigrationMovesReleasesToLabels(t *testing.T) {
	a := newTestApp(t)
	shipped := newTask(t, a, map[string]any{"labels": []string{"Bug"}, "status": "done"})
	twice := newTask(t, a, map[string]any{"labels": []string{"release-0.20.0"}, "status": "done"})
	plain := newTask(t, a, map[string]any{"labels": []string{"Idea"}})
	// Reconstruct the 0.22.0 schema with stamped releases.
	tasks, err := a.app.FindCollectionByNameOrId("crew_tasks")
	if err != nil {
		t.Fatal(err)
	}
	tasks.Fields.Add(&core.TextField{Name: "release", Max: 32})
	if err = a.app.Save(tasks); err != nil {
		t.Fatal(err)
	}
	for id, release := range map[string]string{shipped["id"].(string): "0.19.0", twice["id"].(string): "0.20.0"} {
		if _, err = a.app.DB().NewQuery("UPDATE crew_tasks SET release={:r} WHERE id={:id}").Bind(map[string]any{"r": release, "id": id}).Execute(); err != nil {
			t.Fatal(err)
		}
	}
	before := map[string]*core.Record{}
	for _, row := range []map[string]any{shipped, twice, plain} {
		before[row["id"].(string)] = apiWebhookRecord(t, a, "tasks", row["id"].(string))
	}
	if err = runFixtureMigration(t, a.app, "../../pb_migrations/1801700000_crew_task_release_labels.js"); err != nil {
		t.Fatal(err)
	}
	tasks, err = a.app.FindCollectionByNameOrId("crew_tasks")
	if err != nil {
		t.Fatal(err)
	}
	if tasks.Fields.GetByName("release") != nil {
		t.Fatal("release column survived the migration")
	}
	labels := func(id string) []string {
		var out []string
		if err := json.Unmarshal([]byte(apiWebhookRecord(t, a, "tasks", id).GetString("labels")), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	if got := labels(shipped["id"].(string)); !slices.Equal(got, []string{"Bug", "release-0.19.0"}) {
		t.Fatal("release label not added", got)
	}
	if got := labels(twice["id"].(string)); !slices.Equal(got, []string{"release-0.20.0"}) {
		t.Fatal("existing release label duplicated", got)
	}
	if got := labels(plain["id"].(string)); !slices.Equal(got, []string{"Idea"}) {
		t.Fatal("task without release changed", got)
	}
	for id, old := range before {
		now := apiWebhookRecord(t, a, "tasks", id)
		want := old.GetInt("revision")
		if id == shipped["id"].(string) {
			want++
		}
		if now.GetInt("revision") != want || now.GetString("updated") != old.GetString("updated") {
			t.Fatal("migration changed updated or revision unexpectedly", id, now.PublicExport())
		}
	}
	// The label filter finds the migrated release; the release field is refused.
	found := readJSON(t, a, map[string]any{"collection": "tasks", "label": "release-0.19.0", "fields": []string{"title"}}, 200)
	if items := found["items"].([]any); len(items) != 1 || items[0].(map[string]any)["id"] != shipped["id"] {
		t.Fatal("label filter missed the migrated release", found)
	}
}

func TestTaskReleaseFieldIsRefusedWithLabelHint(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	id := task["id"].(string)
	for _, agent := range []bool{false, true} {
		got := crewWrite(t, a, agent, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "done", "release": "0.23.0"}, 400)
		if !strings.Contains(stringify(got), "release_field_removed") {
			t.Fatal("write with release not refused clearly", got)
		}
	}
	got := readJSON(t, a, map[string]any{"collection": "tasks", "release": "0.23.0"}, 400)
	if !strings.Contains(stringify(got), "release_field_removed") {
		t.Fatal("read with release not refused clearly", got)
	}
	// In-session approval with a release label still closes the task.
	done := crewWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{
		"status": "done", "labels": []string{"release-0.23.0"}, "review_mode": "in_session",
	}, 200)
	if done["status"] != "done" || done["review_mode"] != "in_session" || done["approved_at"] == "" {
		t.Fatal("in-session approval with release label failed", done)
	}
	if _, ok := done["release"]; ok {
		t.Fatal("task still exports release", done)
	}
}

func readJSON(t *testing.T, a *testApp, body map[string]any, want int) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(body)
	return a.request(t, "POST", "/api/crew/read", a.token, string(raw), want)
}

func stringify(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
