package crewruntime

import (
	"mime"
	"testing"
)

// Downloads keep the original file name, including spaces and non-ASCII
// characters, in a header every browser reads back exactly.
func TestContentDispositionKeepsOriginalName(t *testing.T) {
	for _, name := range []string{"concept-14.png", "concept 14.png", "concept 14 – café.png", "報告.pdf"} {
		value := contentDisposition("attachment", name)
		kind, params, err := mime.ParseMediaType(value)
		if err != nil || kind != "attachment" || params["filename"] != name {
			t.Fatalf("%q -> %q (%q, %v, %v)", name, value, kind, params, err)
		}
	}
}
