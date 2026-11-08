package appconfig

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/pocketcontext-labs/pocketcontext-core/appserver/routepolicytest"

	"github.com/pocketcontext-labs/pocketcontext-crew/internal/crewpolicy"
)

// routeCase is one row of the frozen public route table. The JSON file stays
// byte-identical across the move of the allowlist out of this package.
type routeCase struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Allow  bool   `json:"allow"`
}

const publicRouteTable = "testdata/public_routes.json"

func TestPublicRouteTable(t *testing.T) {
	data, err := os.ReadFile(publicRouteTable)
	if err != nil {
		t.Fatal(err)
	}
	var table []routeCase
	if err := json.Unmarshal(data, &table); err != nil {
		t.Fatal(err)
	}
	if len(table) < 400 {
		t.Fatalf("table has %d rows", len(table))
	}
	allowed := 0
	for _, c := range table {
		if c.Allow {
			allowed++
		}
		if got := crewpolicy.PublicRoute(c.Method, c.Path); got != c.Allow {
			t.Errorf("%s %s: allowed=%v, want %v", c.Method, c.Path, got, c.Allow)
		}
	}
	if allowed == 0 {
		t.Fatal("table allows nothing")
	}
}

func TestPublicRouteCommonDenied(t *testing.T) {
	routepolicytest.Check(t, crewpolicy.PublicRoute, routepolicytest.CommonDenied())
}
