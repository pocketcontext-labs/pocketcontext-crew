package searchread

import (
	"errors"
	"strings"
	"testing"
)

func TestMatchExpressionIsLiteral(t *testing.T) {
	for in, want := range map[string]string{
		"alpha":            `"alpha"`,
		"alpha beta*":      `"alpha" AND "beta"*`,
		`a"b NEAR( title:`: `"a""b" AND "NEAR(" AND "title:"`,
		"OR AND NOT":       `"OR" AND "AND" AND "NOT"`,
		"*":                `"*"`,
	} {
		got, err := matchExpression(in)
		if err != nil || got != want {
			t.Errorf("%q: got %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "  ", strings.Repeat("x ", MaxTerms+1), "**"} {
		if _, err := matchExpression(in); !errors.Is(err, ErrInvalidQuery) {
			t.Errorf("%q accepted", in)
		}
	}
}

func TestNormalizeBounds(t *testing.T) {
	req := Request{Query: "x"}
	if err := Normalize(&req); err != nil || req.Limit != DefaultLimit || len(req.Collections) != 2 {
		t.Fatalf("defaults: %+v %v", req, err)
	}
	for _, bad := range []Request{
		{Query: "x", Limit: MaxLimit + 1},
		{Query: "x", Limit: -1},
		{Query: "x", Offset: -1},
		{Query: "x", Offset: MaxOffset + 1},
		{Query: "x", Collections: []string{"events"}},
		{Query: "x", Collections: []string{"tasks", "tasks"}},
		{Query: "x\x00"},
		{Query: "\xff"},
		{Query: "x", Generation: strings.Repeat("g", 65)},
	} {
		if err := Normalize(&bad); !errors.Is(err, ErrInvalidQuery) {
			t.Errorf("accepted %+v", bad)
		}
	}
}
