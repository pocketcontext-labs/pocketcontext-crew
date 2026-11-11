package crewruntime

import (
	"reflect"
	"testing"
)

func TestMarkdownRefsMatchReaderSemantics(t *testing.T) {
	const id = "abcdefghijklmno"
	cases := []struct {
		name, text string
		refs       []string
		dataImage  bool
	}{
		{"inline image", "![a](attachment:" + id + ")", []string{id}, false},
		{"inline link with title", `[a](attachment:` + id + ` "t")`, []string{id}, false},
		{"pointy destination", "[a](<attachment:" + id + ">)", []string{id}, false},
		{"autolink", "<attachment:" + id + ">", []string{id}, false},
		{"upper-case scheme", "![a](ATTACHMENT:" + id + ")", []string{id}, false},
		{"mixed-case autolink", "<AtTaChMeNt:" + id + ">", []string{id}, false},
		{"backslash escape", `![a](attachment\:` + id + `)`, []string{id}, false},
		{"numeric entity", "![a](attachment&#58;" + id + ")", []string{id}, false},
		{"hex entity", "![a](attachment&#x3A;" + id + ")", []string{id}, false},
		{"named entity", "![a](attachment&colon;" + id + ")", []string{id}, false},
		{"entity in scheme", "![a](&#97;ttachment:" + id + ")", []string{id}, false},
		{"definition", "[x]: attachment:" + id + "\n\n![x]", []string{id, id}, false},
		{"unused definition", "[x]: attachment:" + id, []string{id}, false},
		{"definition in blockquote", "> [x]: attachment:" + id, []string{id}, false},
		{"definition in list", "- item\n\n  [x]: ATTACHMENT&#58;" + id, []string{id}, false},
		{"definition in nested quote and list", "> - [x]: <attachment\\:" + id + ">", []string{id}, false},
		{"prose is not a reference", "attachment: see below", nil, false},
		{"code span is not a link", "`![a](attachment:" + id + ")`", nil, false},
		{"fenced code is not a link", "```\n![a](attachment:" + id + ")\n```", nil, false},
		{"other schemes", "[a](https://example.com/attachment:x) ![b](picture.png)", nil, false},
		{"placeholder", "![a](attachment:new-1)", []string{"new-1"}, false},
		{"data image", "![a](data:image/png;base64,AAAA)", nil, true},
		{"data image upper case", "![a](DATA:image/png;base64,AAAA)", nil, true},
		{"data image entity", "![a](&#100;ata:image/png;base64,AAAA)", nil, true},
		{"data image escape", `![a](data\:image/png;base64,AAAA)`, nil, true},
		{"data definition in quote", "> [d]: data:image/png;base64,AAAA", nil, true},
		{"data link is not an image", "[a](data:text/plain,hi)", nil, false},
		{"unknown entity stays", "![a](attachment&nope;" + id + ")", nil, false},
	}
	for _, c := range cases {
		refs, dataImage := markdownRefs(c.text)
		if !reflect.DeepEqual(refs, c.refs) || dataImage != c.dataImage {
			t.Errorf("%s: refs %q data %v; want %q %v", c.name, refs, dataImage, c.refs, c.dataImage)
		}
	}
}

func TestDecodeDestination(t *testing.T) {
	for in, want := range map[string]string{
		`a\:b`:        "a:b",
		`a\\:b`:       `a\:b`,
		`\&#58;`:      "&#58;", // an escaped & starts no reference
		"&#0;":        "\uFFFD",
		"&#x110000;":  "\uFFFD",
		"&amp;colon;": "&colon;",
		"&#12345678;": "&#12345678;",
		"a&b":         "a&b",
	} {
		if got := decodeDestination(in); got != want {
			t.Errorf("decode %q = %q; want %q", in, got, want)
		}
	}
}
