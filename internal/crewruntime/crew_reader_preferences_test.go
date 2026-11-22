package crewruntime

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// Crew 0.36.0: the reader's language and what tapping an agent on Home does
// are owner settings on crew_settings, written with settings.update.
func TestReaderPreferencesSetting(t *testing.T) {
	a := newTestApp(t)
	read := a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"settings"}`, 200)
	s := read["items"].([]any)[0].(map[string]any)
	if s["language"] != "" || s["agent_tap"] != nil {
		t.Fatal("default reader preferences", s)
	}
	id, rev := s["id"].(string), int(s["revision"].(float64))
	agent := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "Synthetic coder", "kind": "external"}, 200)["id"].(string)

	for _, data := range []map[string]any{
		{},
		{"instance_line_visible": "true"},
		{"instance_line_color": 123},
		{"instance_line_color": "red"},
		{"language": "fr"},
		{"language": 1},
		{"agent_tap": "open_agent"},
		{"agent_tap": []any{}},
		{"agent_tap": map[string]any{"all": "unknown"}},
		{"agent_tap": map[string]any{"all": "open_agent", "extra": true}},
		{"agent_tap": map[string]any{"agents": map[string]any{agent: "run_wild"}}},
		{"agent_tap": map[string]any{"agents": map[string]any{"zzzzzzzzzzzzzzz": "show_tasks"}}},
		{"agent_tap": map[string]any{"agents": map[string]any{"not an id": "show_tasks"}}},
		{"agent_tap": map[string]any{"agents": []any{"show_tasks"}}},
	} {
		crewWrite(t, a, false, "settings.update", id, rev, data, 400)
	}
	many := map[string]any{}
	for i := 0; i < 201; i++ {
		many[fmt.Sprintf("%015d", i)] = "show_tasks"
	}
	crewWrite(t, a, false, "settings.update", id, rev, map[string]any{"agent_tap": map[string]any{"agents": many}}, 400)

	tap := map[string]any{"all": "copy_prompt", "agents": map[string]any{agent: "show_tasks"}}
	updated := crewWrite(t, a, false, "settings.update", id, rev, map[string]any{"language": "de", "agent_tap": tap}, 200)
	if updated["language"] != "de" || updated["revision"] != float64(rev+1) || updated["session_guide_off"] != false {
		t.Fatal("settings.update", updated)
	}
	got, _ := json.Marshal(updated["agent_tap"])
	want, _ := json.Marshal(tap)
	if string(got) != string(want) {
		t.Fatalf("agent_tap %s, want %s", got, want)
	}
	// Work clients share the operation (an owner-asked language change).
	again := crewWrite(t, a, true, "settings.update", id, rev+1, map[string]any{"language": ""}, 200)
	if again["language"] != "" || again["agent_tap"] == nil {
		t.Fatal("language reset keeps agent_tap", again)
	}
	cleared := crewWrite(t, a, false, "settings.update", id, rev+2, map[string]any{"agent_tap": nil}, 200)
	if raw, _ := json.Marshal(cleared["agent_tap"]); string(raw) != "{}" {
		t.Fatalf("cleared agent_tap %s", raw)
	}
	events := eventsOf(t, a, id, "settings.update")
	if len(events) != 3 || !strings.Contains(events[0].GetString("changes"), "agent_tap") {
		t.Fatal("settings.update events", len(events))
	}
	doc := capabilitiesItem(t, a, `{"collection":"capabilities"}`)
	op := doc["operations"].(map[string]any)["settings.update"].(map[string]any)
	props := op["data_schema"].(map[string]any)["properties"].(map[string]any)
	if props["language"] == nil || props["agent_tap"] == nil {
		t.Fatal("settings.update schema", props)
	}
}

func TestInstanceLineSettings(t *testing.T) {
	a := newTestApp(t)
	read := func() map[string]any {
		return a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"settings"}`, 200)["items"].([]any)[0].(map[string]any)
	}
	s := read()
	if s["instance_line_visible"] != false || s["instance_line_color"] != "" {
		t.Fatal("initial line settings", s)
	}
	id, rev := s["id"].(string), int(s["revision"].(float64))
	crewWrite(t, a, false, "settings.update", id, rev, map[string]any{"instance_line_visible": true, "instance_line_color": "#ABCDEF"}, 200)
	if got := read(); got["instance_line_visible"] != true || got["instance_line_color"] != "#abcdef" {
		t.Fatal("persisted line settings", got)
	}
	crewWrite(t, a, false, "settings.update", id, rev, map[string]any{"instance_line_visible": false}, 409)
	crewWrite(t, a, false, "settings.update", id, rev+1, map[string]any{"instance_line_visible": false}, 200)
	if got := read(); got["instance_line_visible"] != false || got["instance_line_color"] != "#abcdef" {
		t.Fatal("hiding must retain the selected color", got)
	}
}
