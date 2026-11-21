"""OTP-protected mobile rehearsal gateway. Run behind TLS with both public Hosts preserved."""

import argparse
import asyncio
import html
import json
import re
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode

from aiohttp import ClientSession, ClientTimeout, DummyCookieJar, WSMsgType, web
from multidict import CIMultiDict
from yarl import URL

BASE = "/_gateway"
SESSION = "__Host-crew-rehearsal"
FLOW = "__Host-crew-flow"
HANDOFF = "__Host-crew-handoff"
HOURS = 8 * 3600
HOST = re.compile(
    r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?"
)
SIM = {
    "/": "GET",
    "/app.js": "GET",
    "/style.css": "GET",
    "/favicon.ico": "GET",
    "/api/state": "GET",
    "/api/chat": "POST",
    "/api/mode": "POST",
}
HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "forwarded",
    "via",
}
SAFE = {"GET", "HEAD"}
# These endpoints authenticate native clients through Crew OAuth.
CLIENT_ROUTES = {
    "/mcp": {"POST", "GET", "DELETE"},
    "/.well-known/oauth-protected-resource": SAFE,
    "/.well-known/oauth-protected-resource/mcp": SAFE,
    "/.well-known/oauth-authorization-server": SAFE,
    "/oauth/register": {"POST"},
    "/oauth/token": {"POST"},
    "/oauth/revoke": {"POST"},
}


@dataclass
class Timed:
    value: object
    expires: float


class Store:
    def __init__(self):
        self.entries = {}

    def put(self, value, ttl, maximum=1024):
        now = time.monotonic()
        self.entries = {k: v for k, v in self.entries.items() if v.expires > now}
        if len(self.entries) >= maximum:
            raise web.HTTPTooManyRequests()
        key = secrets.token_urlsafe(32)
        self.entries[key] = Timed(value, now + ttl)
        return key

    def get(self, key):
        item = self.entries.get(key)
        if item and item.expires > time.monotonic():
            return item.value
        self.entries.pop(key, None)
        return None

    def take(self, key):
        item = self.get(key)
        self.entries.pop(key, None)
        return item


def cookie(response, name, value, age):
    response.set_cookie(
        name, value, max_age=age, path="/", secure=True, httponly=True, samesite="Lax"
    )


def page(title, content, script=""):
    nonce = secrets.token_urlsafe(24)
    document = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{title}</title>
<style nonce="{nonce}">*{{box-sizing:border-box}}body{{margin:0;background:#f5f6f1;color:#243d30;font:16px system-ui}}
main{{max-width:30rem;margin:9vh auto;padding:1.6rem;background:#fffefb;border:1px solid #d2dbd0;border-radius:16px}}
h1{{font-size:1.65rem}}input,button{{display:block;width:100%;font:inherit;border-radius:8px;padding:.7rem;margin:.5rem 0 1rem}}
button{{background:#29553d;color:white;border:0;cursor:pointer}}p{{line-height:1.45}}</style></head>
<body><main><small>PocketContext Crew</small><h1>{title}</h1>{content}</main>
<script data-cfasync="false" nonce="{nonce}">{script}</script></body></html>"""
    return web.Response(
        text=document,
        content_type="text/html",
        headers={
            "Content-Security-Policy": f"default-src 'none'; style-src 'nonce-{nonce}'; script-src 'nonce-{nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
        },
    )


def login_form(code=False, error=""):
    path = "verify" if code else "request"
    label, name, attrs = (
        (
            "Email code",
            "code",
            'inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"',
        )
        if code
        else ("Owner email", "email", 'type="email" autocomplete="email"')
    )
    return page(
        "Sign in to the rehearsal",
        (f'<p role="alert">{html.escape(error)}</p>' if error else "")
        + (
            (
                "<p>If the address matches the owner, Crew has emailed a six-digit code. Enter it here.</p>"
            )
            if code
            else ""
        )
        + f'<form method="post" action="{BASE}/{path}"><label>{label}<input name="{name}" {attrs} required></label>'
        f"<button>{'Sign in' if code else 'Email me a code'}</button></form>",
    )


def as_js(value):
    return json.dumps(value, ensure_ascii=True).replace("<", "\\u003c")


class Gateway:
    def __init__(
        self, crew_host, sim_host, owner_email, crew_port=58000, sim_port=58001
    ):
        if (
            not all(HOST.fullmatch(h) for h in (crew_host, sim_host))
            or crew_host == sim_host
        ):
            raise ValueError("Choose two distinct lowercase DNS hostnames")
        self.crew, self.sim = crew_host, sim_host
        self.owner = owner_email.strip().casefold()
        if not self.owner or "@" not in self.owner:
            raise ValueError("Provide the registered Crew owner email")
        self.upstream = {
            crew_host: f"http://127.0.0.1:{crew_port}",
            sim_host: f"http://127.0.0.1:{sim_port}",
        }
        self.sessions, self.flows, self.requests, self.tickets = (
            Store(),
            Store(),
            Store(),
            Store(),
        )
        self.logouts = Store()
        self.last_mail = 0.0
        self.client = None

    async def lifespan(self, app):
        async with ClientSession(
            cookie_jar=DummyCookieJar(),
            auto_decompress=False,
            timeout=ClientTimeout(total=None, sock_connect=8),
        ) as client:
            self.client = client
            yield

    def app(self):
        app = web.Application(client_max_size=32 * 1024 * 1024)
        app.cleanup_ctx.append(self.lifespan)
        app.on_response_prepare.append(self.headers)
        app.router.add_route("*", "/{rest:.*}", self.route)
        return app

    async def headers(self, request, response):
        response.headers["Cache-Control"] = "no-store, no-transform"
        response.headers["X-Crew-Rehearsal-Gateway"] = "1"
        # Origin-only referrers keep handoff tickets out of subsequent requests.
        # Chromium sends Origin: null on native form POSTs under "no-referrer".
        response.headers["Referrer-Policy"] = "strict-origin"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"

    def session(self, request, host):
        grant = self.sessions.get(request.cookies.get(SESSION))
        return (
            grant
            if grant
            and grant["host"] == host
            and not grant["login"]["revoked"].is_set()
            else None
        )

    def set_session(self, response, host, login):
        if login["revoked"].is_set():
            raise web.HTTPUnauthorized()
        ttl = min(HOURS, int(login["expires"] - time.monotonic()))
        if ttl <= 0:
            raise web.HTTPUnauthorized()
        key = self.sessions.put({"host": host, "login": login}, ttl)
        cookie(response, SESSION, key, ttl)

    def login_done(self, login, flow):
        target = flow.get("authorize") or "/"
        request_id = flow.get("sso")
        if request_id:
            pending = self.requests.get(request_id)
            if not pending:
                raise web.HTTPBadRequest(
                    text="Handoff expired. Open the simulator again."
                )
            ticket = self.tickets.put({"request": request_id, "login": login}, 60)
            target = f"https://{self.sim}{BASE}/finish?" + urlencode({"ticket": ticket})
        # Only the Crew origin receives its normal reader credentials.
        script = (
            f'localStorage.setItem("pocketcontext.reader.auth", JSON.stringify({as_js(login["auth"])}));'
            'localStorage.setItem("pocketcontext.rehearsal.gateway", "1");'
            f"location.replace({as_js(target)});"
        )
        return page("Signed in", "<p>Opening the rehearsal…</p>", script)

    async def auth_call(self, name, payload):
        url = self.upstream[self.crew] + "/api/collections/users/" + name
        async with self.client.post(
            url,
            json=payload,
            allow_redirects=False,
            timeout=12,
            headers={
                "Host": self.crew,
                "X-Forwarded-Proto": "https",
                "Accept-Encoding": "identity",
            },
        ) as response:
            if response.status != 200:
                return {}
            return await response.json()

    async def gate(self, request, host, grant):
        path = request.path
        if path == BASE + "/logout" and request.method == "POST":
            if not grant:
                raise web.HTTPUnauthorized()
            grant["login"]["revoked"].set()
            ticket = self.logouts.put(True, 60)
            response = web.HTTPSeeOther(
                f"https://{self.crew}{BASE}/signed-out?" + urlencode({"ticket": ticket})
            )
            cookie(response, SESSION, "", 0)
            raise response
        if (
            path == BASE + "/signed-out"
            and host == self.crew
            and request.method == "GET"
        ):
            if not self.logouts.take(request.query.get("ticket")):
                raise web.HTTPForbidden()
            response = page(
                "Signed out",
                f'<a href="{BASE}/login">Sign in again</a>',
                'localStorage.removeItem("pocketcontext.reader.auth");'
                'localStorage.removeItem("pocketcontext.rehearsal.gateway");'
                'history.replaceState(null,"","/_gateway/signed-out");',
            )
            cookie(response, SESSION, "", 0)
            return response
        if path == BASE + "/login" and request.method == "GET":
            if host == self.sim:
                if grant:
                    raise web.HTTPSeeOther("/")
                binding = secrets.token_urlsafe(32)
                key = self.requests.put(binding, 600)
                response = web.HTTPSeeOther(
                    f"https://{self.crew}{BASE}/login?" + urlencode({"sso": key})
                )
                cookie(response, HANDOFF, binding, 600)
                raise response
            sso = request.query.get("sso")
            if sso and not self.requests.get(sso):
                raise web.HTTPBadRequest(
                    text="Handoff expired. Open the simulator again."
                )
            flow = {"sso": sso}
            if grant:
                return self.login_done(grant["login"], flow)
            response = login_form()
            cookie(response, FLOW, self.flows.put(flow, 600), 600)
            return response
        if path == BASE + "/finish" and host == self.sim and request.method == "GET":
            key = request.query.get("ticket")
            ticket = self.tickets.get(key)
            binding = self.requests.get(ticket["request"]) if ticket else None
            if not binding or not secrets.compare_digest(
                binding, request.cookies.get(HANDOFF, "")
            ):
                raise web.HTTPForbidden()
            self.requests.take(ticket["request"])
            self.tickets.take(key)
            response = web.HTTPSeeOther("/")
            cookie(response, HANDOFF, "", 0)
            self.set_session(response, host, ticket["login"])
            raise response
        if (
            host != self.crew
            or request.method != "POST"
            or path not in (BASE + "/request", BASE + "/verify")
        ):
            raise web.HTTPNotFound()
        token = request.cookies.get(FLOW)
        flow = self.flows.get(token)
        if flow is None:
            raise web.HTTPForbidden(text="Login expired. Open the rehearsal again.")
        if (
            request.content_type != "application/x-www-form-urlencoded"
            or not 0 < (request.content_length or 0) <= 1024
        ):
            raise web.HTTPBadRequest()
        data = await request.post()
        if path == BASE + "/request":
            if flow.get("requested"):
                raise web.HTTPConflict()
            flow["requested"] = True
            if str(data.get("email", "")).strip().casefold() == self.owner:
                if time.monotonic() - self.last_mail < 15:
                    raise web.HTTPTooManyRequests(
                        text="Wait a moment before requesting another email."
                    )
                self.last_mail = time.monotonic()
                result = await self.auth_call("request-otp", {"email": self.owner})
                if not result.get("otpId"):
                    raise web.HTTPBadGateway(text="Crew could not send the login code.")
                flow["otp"] = result["otpId"]
            return login_form(True)
        otp = flow.get("otp")
        code = data.get("code", "")
        auth = (
            await self.auth_call("auth-with-otp-code", {"otpId": otp, "code": code})
            if otp and re.fullmatch("[0-9]{6}", code)
            else {}
        )
        record = auth.get("record") or {}
        if (
            not auth.get("token")
            or record.get("collectionName") != "users"
            or str(record.get("email", "")).casefold() != self.owner
        ):
            return login_form(True, "The code is invalid or expired.")
        if self.flows.take(token) is None:
            raise web.HTTPForbidden()
        login = {
            "auth": {"record": record, "token": auth["token"]},
            "expires": time.monotonic() + HOURS,
            "revoked": asyncio.Event(),
        }
        response = self.login_done(login, flow)
        cookie(response, FLOW, "", 0)
        self.set_session(response, host, login)
        return response

    async def route(self, request):
        host = request.headers.get("Host")
        if host not in self.upstream:
            raise web.HTTPMisdirectedRequest()
        origin = "https://" + host
        websocket = request.headers.get("Upgrade", "").lower() == "websocket"
        path = request.rel_url.raw_path
        if host == self.crew and not websocket and request.method in CLIENT_ROUTES.get(path, ()):
            if "Origin" in request.headers and request.headers["Origin"] != origin:
                raise web.HTTPForbidden(text="Same-origin request required.")
            return await self.proxy(request, host, False, None)
        if (request.method not in SAFE or websocket) and request.headers.get(
            "Origin"
        ) != origin:
            raise web.HTTPForbidden(text="Same-origin request required.")
        # Crew's consent UI authenticates its decision with a bearer token and omits cookies.
        if (host == self.crew and path == "/oauth/authorize" and request.method == "POST"
                and not websocket and request.headers.get("Authorization", "").startswith("Bearer ")):
            return await self.proxy(request, host, False, None)
        if request.path.startswith(BASE + "/"):
            return await self.gate(request, host, self.session(request, host))
        if request.path == "/webhook":
            raise web.HTTPNotFound()
        grant = self.session(request, host)
        if not grant:
            if host == self.crew and path == "/oauth/authorize" and request.method == "GET" and not websocket:
                response = login_form()
                flow = {"authorize": "/oauth/authorize?" + request.rel_url.raw_query_string}
                cookie(response, FLOW, self.flows.put(flow, 600), 600)
                return response
            if request.path == "/" and request.method == "GET" and not websocket:
                raise web.HTTPSeeOther(BASE + "/login")
            raise web.HTTPUnauthorized()
        if host == self.sim and (SIM.get(request.path) != request.method or websocket):
            raise web.HTTPNotFound()
        if websocket and (host != self.crew or request.path != "/__ui_hmr"):
            raise web.HTTPNotFound()
        if request.method not in (
            "GET",
            "HEAD",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
        ):
            raise web.HTTPMethodNotAllowed(request.method, ("GET", "POST"))
        return await self.proxy(request, host, websocket, grant)

    async def proxy(self, request, host, websocket, grant):
        # Construct the upstream authority exclusively from configuration, retaining encoded paths.
        upstream = self.upstream[host]
        target = URL(upstream + request.rel_url.raw_path_qs, encoded=True)
        blocked = HOP | {
            "host",
            "cookie",
            "origin",
            "sec-fetch-site",
            "content-length",
            "accept-encoding",
            "expect",
            "authorization",
        }
        blocked.update(
            s.strip().lower() for s in request.headers.get("Connection", "").split(",")
        )
        headers = {
            k: v
            for k, v in request.headers.items()
            if k.lower() not in blocked
            and not k.lower().startswith(("x-forwarded-", "sec-websocket-"))
        }
        if host == self.crew:
            headers.update({"Host": host, "X-Forwarded-Proto": "https"})
            if "Authorization" in request.headers:
                headers["Authorization"] = request.headers["Authorization"]
            if "Origin" in request.headers:
                headers["Origin"] = "https://" + host
        elif request.method not in SAFE:
            headers["Origin"] = upstream
        try:
            if websocket:
                return await self.relay_ws(request, target, headers, grant)
            body = None
            if request.can_read_body:
                if host == self.sim:
                    if request.content_length is None or request.content_length > 32768:
                        raise web.HTTPRequestEntityTooLarge(
                            max_size=32768, actual_size=request.content_length or 0
                        )
                    body = await request.read()
                    if len(body) > 32768:
                        raise web.HTTPRequestEntityTooLarge(
                            max_size=32768, actual_size=len(body)
                        )
                else:
                    body = request.content.iter_chunked(65536)
            async with self.client.request(
                request.method,
                target,
                headers=headers,
                data=body,
                allow_redirects=False,
            ) as source:
                exclude = HOP | {
                    "set-cookie",
                    "access-control-allow-origin",
                    "access-control-allow-credentials",
                }
                exclude.update(
                    s.strip().lower()
                    for s in source.headers.get("Connection", "").split(",")
                )
                forwarded = CIMultiDict(
                    (k, v)
                    for k, v in source.headers.items()
                    if k.lower() not in exclude
                )
                if host == self.sim and request.path == "/":
                    forwarded["Content-Security-Policy"] = (
                        "default-src 'none'; script-src 'self'; style-src 'self'; "
                        "connect-src 'self'; frame-ancestors 'none'; form-action 'self'"
                    )
                response = web.StreamResponse(status=source.status, headers=forwarded)
                await response.prepare(request)
                async for chunk in source.content.iter_chunked(65536):
                    await response.write(chunk)
                await response.write_eof()
                return response
        except (OSError, TimeoutError):
            raise web.HTTPBadGateway(text="The rehearsal service is unavailable.")

    async def relay_ws(self, request, target, headers, grant):
        protocol = "vite-hmr"
        if protocol not in [
            p.strip()
            for p in request.headers.get("Sec-WebSocket-Protocol", "").split(",")
        ]:
            raise web.HTTPBadRequest()
        async with self.client.ws_connect(
            target, headers=headers, protocols=(protocol,)
        ) as remote:
            local = web.WebSocketResponse(protocols=(protocol,))
            await local.prepare(request)

            async def copy(source, destination):
                async for message in source:
                    if message.type == WSMsgType.TEXT:
                        await destination.send_str(message.data)
                    elif message.type == WSMsgType.BINARY:
                        await destination.send_bytes(message.data)
                    else:
                        break

            tasks = [
                asyncio.create_task(copy(local, remote)),
                asyncio.create_task(copy(remote, local)),
                asyncio.create_task(grant["login"]["revoked"].wait()),
            ]
            try:
                await asyncio.wait(
                    tasks,
                    timeout=max(0, grant["login"]["expires"] - time.monotonic()),
                    return_when=asyncio.FIRST_COMPLETED,
                )
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                await local.close()
            return local


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crew-host", required=True)
    parser.add_argument("--sim-host", required=True)
    parser.add_argument("--owner-email", required=True)
    parser.add_argument("--port", type=int, default=57993)
    args = parser.parse_args()
    gateway = Gateway(args.crew_host, args.sim_host, args.owner_email)
    web.run_app(gateway.app(), host="127.0.0.1", port=args.port, access_log=None)


if __name__ == "__main__":
    main()
