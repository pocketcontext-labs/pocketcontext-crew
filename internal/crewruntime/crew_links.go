package crewruntime

import (
	"fmt"
	"strings"
	"unicode"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"golang.org/x/text/unicode/norm"
)

const crewSlugMaxLength = 60

// crewSlugFallbacks lists the collections with permanent links and the slug
// used when a title has nothing transliterable.
var crewSlugFallbacks = map[string]string{"tasks": "task", "notes": "note"}

// crewSlugLetters covers common Latin letters that have no canonical
// decomposition. Keys are lowercase: letters are lowered before the lookup.
var crewSlugLetters = map[rune]string{
	'ß': "ss", 'æ': "ae", 'œ': "oe", 'ø': "o", 'ł': "l",
	'đ': "d", 'ð': "d", 'þ': "th", 'ı': "i",
}

// crewSlug is the only slug implementation: hooks reach it through the
// crewRecordLink binding and search calls it directly.
func crewSlug(title, fallback string) string {
	var b strings.Builder
	hyphen := func() {
		if s := b.String(); s != "" && s[len(s)-1] == '-' {
			return
		}
		b.WriteByte('-')
	}
	for _, r := range norm.NFD.String(title) {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		r = unicode.ToLower(r)
		switch mapped, ok := crewSlugLetters[r]; {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case ok:
			b.WriteString(mapped)
		default:
			hyphen()
		}
	}
	slug := b.String()
	if len(slug) > crewSlugMaxLength {
		slug = slug[:crewSlugMaxLength]
	}
	if slug = strings.Trim(slug, "-"); slug != "" {
		return slug
	}
	return fallback
}

// crewRecordLink returns a task's or note's derived permanent link: always
// "path", plus an absolute "url" only when the install has a base URL.
func crewRecordLink(app core.App, collection, id, title string) (map[string]string, error) {
	fallback, ok := crewSlugFallbacks[collection]
	if !ok {
		return nil, fmt.Errorf("no permanent links for collection %q", collection)
	}
	path := "#/" + collection + "/" + crewSlug(title, fallback) + "-" + id
	link := map[string]string{"path": path}
	if base := webhookInstanceURL(app); base != "" {
		link["url"] = base + "/" + path
	}
	return link, nil
}
