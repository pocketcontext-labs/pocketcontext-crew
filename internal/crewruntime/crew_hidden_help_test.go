package crewruntime

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// Crew 0.37.0: the help panels the owner hid with "Don't show this again" are
// an owner setting on crew_settings (hidden_help), written with settings.update.
func TestHiddenHelpSetting(t *testing.T) {
	a := newTestApp(t)
	read := a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"settings"}`, 200)
	s := read["items"].([]any)[0].(map[string]any)
	if s["hidden_help"] != nil {
		t.Fatal("default hidden_help", s)
	}
	id, rev := s["id"].(string), int(s["revision"].(float64))

	tooMany := []any{}
	for i := 0; i < 101; i++ {
		tooMany = append(tooMany, fmt.Sprintf("page.h%d", i))
	}
	for _, data := range []map[string]any{
		{"hidden_help": "page.home"},
		{"hidden_help": map[string]any{"page.home": true}},
		{"hidden_help": []any{1}},
		{"hidden_help": []any{""}},
		{"hidden_help": []any{"Page.Home"}},
		{"hidden_help": []any{"page home"}},
		{"hidden_help": []any{strings.Repeat("a", 65)}},
		{"hidden_help": tooMany},
		{"hidden_help": []any{"page.home"}, "extra": true},
	} {
		crewWrite(t, a, false, "settings.update", id, rev, data, 400)
	}

	updated := crewWrite(t, a, false, "settings.update", id, rev, map[string]any{"hidden_help": []any{"page.home", "home.guide_row", "page.home"}}, 200)
	got, _ := json.Marshal(updated["hidden_help"])
	if string(got) != `["page.home","home.guide_row"]` || updated["revision"] != float64(rev+1) || updated["session_guide_off"] != false {
		t.Fatalf("settings.update hidden_help %s %v", got, updated)
	}
	// Show all help again: one write clears the list and the session guide.
	cleared := crewWrite(t, a, false, "settings.update", id, rev+1, map[string]any{"hidden_help": []any{}, "session_guide_off": false}, 200)
	if raw, _ := json.Marshal(cleared["hidden_help"]); string(raw) != "[]" {
		t.Fatalf("cleared hidden_help %s", raw)
	}
	// Work clients share the operation; null clears too.
	again := crewWrite(t, a, true, "settings.update", id, rev+2, map[string]any{"hidden_help": nil}, 200)
	if raw, _ := json.Marshal(again["hidden_help"]); string(raw) != "[]" {
		t.Fatalf("null hidden_help %s", raw)
	}
	events := eventsOf(t, a, id, "settings.update")
	if len(events) != 3 || !strings.Contains(events[0].GetString("changes"), "hidden_help") {
		t.Fatal("settings.update events", len(events))
	}
	doc := capabilitiesItem(t, a, `{"collection":"capabilities"}`)
	op := doc["operations"].(map[string]any)["settings.update"].(map[string]any)
	props := op["data_schema"].(map[string]any)["properties"].(map[string]any)
	if props["hidden_help"] == nil {
		t.Fatal("settings.update schema", props)
	}
}
