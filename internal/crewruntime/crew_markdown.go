package crewruntime

// Attachment references in Markdown, found on a parsed CommonMark (GFM) tree
// so the server sees the same link and image destinations as the reader
// (react-markdown with remark-gfm): inline links and images, reference
// definitions anywhere (inside block quotes and lists too), and autolinks.
// Destinations are decoded like CommonMark does (backslash escapes and
// entity and numeric character references) before the scheme is compared,
// case-insensitively, so "ATTACHMENT:", "attachment\:" and "attachment&#58;"
// are all references to validate. Code spans and blocks are not links.

import (
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

var crewMarkdown = goldmark.New(goldmark.WithExtensions(extension.GFM, extension.Footnote))

// crewMarkdownRefs is the $pocketcontext binding: refs lists the part after
// "attachment:" of every attachment destination in document order (an
// attachment ID, a new-N placeholder or anything else to refuse);
// data_image reports a data: URL as an image or reference-definition
// destination.
func crewMarkdownRefs(source string) map[string]any {
	refs, dataImage := markdownRefs(source)
	list := make([]any, len(refs))
	for i, r := range refs {
		list[i] = r
	}
	return map[string]any{"refs": list, "data_image": dataImage}
}

func markdownRefs(source string) (refs []string, dataImage bool) {
	src := []byte(source)
	ctx := parser.NewContext()
	doc := crewMarkdown.Parser().Parse(text.NewReader(src), parser.WithContext(ctx))
	add := func(destination string, decode, image bool) {
		if decode {
			destination = decodeDestination(destination)
		}
		trimmed := strings.TrimSpace(destination)
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "attachment:") {
			refs = append(refs, trimmed[len("attachment:"):])
		}
		if image && strings.HasPrefix(lower, "data:") {
			dataImage = true
		}
	}
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch v := n.(type) {
		case *ast.Link:
			add(string(v.Destination), true, false)
		case *ast.Image:
			add(string(v.Destination), true, true)
		case *ast.AutoLink:
			add(string(v.URL(src)), false, false) // autolinks are literal
		}
		return ast.WalkContinue, nil
	})
	// Every definition, used or not (a definition used by a link is also
	// reported by that link; duplicates are harmless).
	for _, r := range ctx.References() {
		add(string(r.Destination()), true, true)
	}
	return refs, dataImage
}

// decodeDestination applies CommonMark's single pass over a link
// destination: a backslash before ASCII punctuation is that character, and
// entity (&name;) and numeric (&#N; &#xH;) references become their text.
func decodeDestination(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		c := s[i]
		if c == '\\' && i+1 < len(s) && util.IsPunct(s[i+1]) {
			b.WriteByte(s[i+1])
			i += 2
			continue
		}
		if c == '&' {
			if decoded, n := characterReference(s[i:]); n > 0 {
				b.WriteString(decoded)
				i += n
				continue
			}
		}
		b.WriteByte(c)
		i++
	}
	return b.String()
}

// characterReference decodes a reference at the start of s, returning the
// text and the bytes consumed (0 when s does not start with one).
func characterReference(s string) (string, int) {
	end := strings.IndexByte(s, ';')
	if end < 2 || end > 40 {
		return "", 0
	}
	body := s[1:end]
	if body[0] == '#' {
		digits, base, limit := body[1:], 10, 7
		if len(digits) > 0 && (digits[0] == 'x' || digits[0] == 'X') {
			digits, base, limit = digits[1:], 16, 6
		}
		if len(digits) == 0 || len(digits) > limit {
			return "", 0
		}
		n, err := strconv.ParseUint(digits, base, 32)
		if err != nil {
			return "", 0
		}
		r := rune(n)
		if r == 0 || !utf8.ValidRune(r) {
			r = utf8.RuneError
		}
		return string(r), end + 1
	}
	for _, c := range []byte(body) {
		if !util.IsAlphaNumeric(c) {
			return "", 0
		}
	}
	if entity, ok := util.LookUpHTML5EntityByName(body); ok {
		return string(entity.Characters), end + 1
	}
	return "", 0
}
