package crewpolicy

import (
	"html"

	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
)

// signInCodeEmail is Crew's hosted sign-in email (since 0.30.0). The code comes
// first in the subject with the word "code", and stands alone as plain digits in
// the body, so Gmail offers its Copy code card and iOS suggests it above the
// keyboard of the reader's code field. An installed home-screen app needs the
// code: the link opens the browser, whose session the app does not share. The
// link stays for browsers and still asks to confirm Log in, so mail scanners
// that open links cannot spend it. Mail clients drop SVG and remote images
// are often blocked, so the mark and the footer wordmark are styled text.
func signInCodeEmail(m appserver.OTPCodeEmail) (subject, body, plain string) {
	code := html.EscapeString(m.Code)
	domain := html.EscapeString(m.Domain)
	link := html.EscapeString(m.Link)
	subject = m.Code + " is your PocketContext sign-in code"
	body = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td align="center" style="padding:48px 24px">` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0d1712">` +
		`<tr><td align="center" style="padding-bottom:28px"><span style="display:inline-block;width:40px;height:40px;line-height:40px;border-radius:12px;background:#0d1712;color:#c8f169;font-size:22px;font-weight:700;text-align:center">&#10003;</span></td></tr>` +
		`<tr><td align="center" style="font-size:44px;line-height:52px;font-weight:700;letter-spacing:4px;color:#0d1712">` + code + `</td></tr>` +
		`<tr><td align="center" style="padding-top:8px;font-size:18px;line-height:26px;color:#0d1712">is your PocketContext sign-in code.</td></tr>` +
		`<tr><td align="center" style="padding-top:16px;font-size:15px;line-height:22px;color:#263b32">The code expires in 15 minutes.</td></tr>` +
		`<tr><td align="center" style="padding-top:28px;font-size:13px;line-height:20px;color:#657168">Never share this code or enter it anywhere other than <a href="https://` + domain + `" style="color:#4c6b3d;text-decoration:underline">` + domain + `</a>.</td></tr>` +
		`<tr><td align="center" style="padding-top:8px;font-size:13px;line-height:20px;color:#657168">If you didn't request this code, you can ignore this email.</td></tr>` +
		`<tr><td align="center" style="padding-top:20px;font-size:13px;line-height:20px;color:#657168">Or open this link in your browser: <a href="` + link + `" style="color:#4c6b3d;text-decoration:underline">Log in to PocketContext</a></td></tr>` +
		`<tr><td style="padding-top:32px"><div style="border-top:1px solid #e3e7de;font-size:0;line-height:0">&nbsp;</div></td></tr>` +
		`<tr><td align="left" style="padding-top:16px;font-size:14px;line-height:20px;font-weight:700;letter-spacing:-0.3px;color:#263b32">PocketContext <span style="font-weight:400;color:#657168">Crew</span></td></tr>` +
		`</table></td></tr></table></body></html>`
	plain = m.Code + "\n\n" +
		"is your PocketContext sign-in code.\n" +
		"The code expires in 15 minutes.\n\n" +
		"Never share this code or enter it anywhere other than " + m.Domain + ".\n" +
		"If you didn't request this code, you can ignore this email.\n\n" +
		"Or open this link in your browser: " + m.Link + "\n\n" +
		"PocketContext Crew\n"
	return subject, body, plain
}
