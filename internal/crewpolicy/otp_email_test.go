package crewpolicy

import (
	"regexp"
	"strings"
	"testing"

	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
)

func TestSignInCodeEmail(t *testing.T) {
	link := "https://crew.example.test/#/login?otp=12345678901234567890123456789012&otpId=abc123"
	subject, body, plain := signInCodeEmail(appserver.OTPCodeEmail{Code: "123456", Link: link, Domain: "crew.example.test"})
	if subject != "123456 is your PocketContext sign-in code" {
		t.Fatalf("subject %q", subject)
	}
	// The code stands alone as plain digits, outside any link, for Gmail's Copy
	// code card and iOS autofill.
	if !regexp.MustCompile(`<td[^>]*>123456</td>`).MatchString(body) {
		t.Fatal("the code is not a standalone line")
	}
	if regexp.MustCompile(`<a[^>]*>[^<]*123456`).MatchString(body) {
		t.Fatal("the code sits inside a link")
	}
	for _, want := range []string{
		"is your PocketContext sign-in code.",
		"expires in 15 minutes",
		`anywhere other than <a href="https://crew.example.test"`,
		"If you didn&#39;t request this code, you can ignore this email.",
		`Or open this link in your browser: <a href="https://crew.example.test/#/login?otp=12345678901234567890123456789012&amp;otpId=abc123"`,
		"Log in to PocketContext</a>",
		"border-top:1px solid",
		"PocketContext <span",
	} {
		if !strings.Contains(body, want) && !strings.Contains(body, strings.ReplaceAll(want, "&#39;", "'")) {
			t.Errorf("HTML misses %q", want)
		}
	}
	if !strings.HasPrefix(plain, "123456\n\nis your PocketContext sign-in code.\n") || !strings.Contains(plain, "Or open this link in your browser: "+link) {
		t.Fatalf("plain text part:\n%s", plain)
	}
	// The same order in both parts: code, sentence, expiry, warnings, link, footer.
	order := []string{"sign-in code.", "15 minutes", "Never share", "didn't request", "Or open this link", "PocketContext Crew"}
	last := -1
	for _, part := range order {
		i := strings.Index(plain, part)
		if i <= last {
			t.Fatalf("plain text order at %q", part)
		}
		last = i
	}
}
