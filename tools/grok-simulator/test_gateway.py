"""End-to-end gateway tests, with a synthetic Crew OTP service and the actual simulator HTTP handler."""

import asyncio
import re
from functools import partial
from http.server import ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from urllib.parse import urlsplit

from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestClient, TestServer

from gateway import BASE, FLOW, HANDOFF, SESSION, Gateway
from server import Handler

CREW = "reader.example.test"
SIM = "bots.example.test"
EMAIL = "owner@example.test"


class GatewayTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.otp_requests = []
        self.sim_events = []
        self.email = EMAIL

        async def crew(request):
            if request.path == "/api/collections/users/request-otp":
                self.otp_requests.append(await request.json())
                return web.json_response({"otpId": "synthetic-id"})
            if request.path == "/api/collections/users/auth-with-otp-code":
                if await request.json() != {"otpId": "synthetic-id", "code": "123456"}:
                    return web.json_response({}, status=400)
                return web.json_response(
                    {
                        "token": "synthetic-reader-token",
                        "record": {
                            "id": "owner",
                            "collectionName": "users",
                            "email": self.email,
                        },
                    }
                )
            if request.path == "/__ui_hmr":
                ws = web.WebSocketResponse(protocols=["vite-hmr"])
                await ws.prepare(request)
                async for msg in ws:
                    await ws.send_str("hot " + msg.data)
                return ws
            return web.json_response(
                {
                    "host": request.host,
                    "proto": request.headers.get("X-Forwarded-Proto"),
                    "cookie": request.headers.get("Cookie"),
                    "auth": request.headers.get("Authorization"),
                }
            )

        app = web.Application()
        app.router.add_route("*", "/{rest:.*}", crew)
        self.crew = TestServer(app)
        await self.crew.start_server()
        self.addAsyncCleanup(self.crew.close)
        stub = SimpleNamespace(
            secret="synthetic-receiver-secret",
            enqueue=lambda *args: self.sim_events.append(args),
        )
        self.sim = ThreadingHTTPServer(
            ("127.0.0.1", 0), partial(Handler, simulator=stub)
        )
        Thread(target=self.sim.serve_forever, daemon=True).start()
        self.addCleanup(self.sim.server_close)
        self.addCleanup(self.sim.shutdown)
        self.gateway = Gateway(CREW, SIM, EMAIL, self.crew.port, self.sim.server_port)
        self.client = TestClient(TestServer(self.gateway.app()))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def request(self, method, path, host=CREW, cookie="", origin=None, **kwargs):
        headers = {"Host": host}
        if cookie:
            headers["Cookie"] = cookie
        if origin:
            headers["Origin"] = origin
        headers.update(kwargs.pop("headers", {}))
        return await self.client.request(
            method, path, headers=headers, allow_redirects=False, **kwargs
        )

    async def test_native_client_uses_crew_oauth(self):
        response = await self.request("POST", "/mcp", headers={"Authorization": "Bearer synthetic"})
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["auth"], "Bearer synthetic")
        self.assertEqual((await self.request("GET", "/.well-known/oauth-authorization-server")).status, 200)
        self.assertEqual((await self.request("POST", "/oauth/token")).status, 200)
        self.assertEqual((await self.request("POST", "/mcp", origin="https://other.example")).status, 403)
        self.assertEqual((await self.request("POST", "/api/crew/write")).status, 403)
        self.assertEqual((await self.request("POST", "/mcp", host=SIM)).status, 403)

    async def test_consent_uses_bearer_without_gateway_cookie(self):
        headers = {"Authorization": "Bearer synthetic"}
        route = "/oauth/authorize"
        result = await self.request("POST", route, headers=headers, origin="https://" + CREW)
        self.assertEqual(result.status, 200)
        self.assertEqual((await result.json())["auth"], headers["Authorization"])
        self.assertEqual((await self.request("POST", route, headers=headers)).status, 403)
        self.assertEqual((await self.request("POST", route, origin="https://" + CREW)).status, 401)

    def cookie(self, response, name):
        item = response.cookies[name]
        self.assertTrue(item["secure"])
        self.assertTrue(item["httponly"])
        self.assertEqual(item["path"], "/")
        self.assertFalse(item["domain"])
        return name + "=" + item.value

    async def login(self, sso):
        start = await self.request("GET", BASE + "/login?" + sso)
        flow = self.cookie(start, FLOW)

        async def form(endpoint, data):
            return await self.request(
                "POST",
                BASE + "/" + endpoint,
                cookie=flow,
                origin="https://" + CREW,
                data=data,
            )

        self.assertEqual((await form("request", {"email": EMAIL})).status, 200)
        self.assertEqual(self.otp_requests, [{"email": EMAIL}])
        wrong = await form("verify", {"code": "999999"})
        self.assertNotIn(SESSION, wrong.cookies)
        return await form("verify", {"code": "123456"})

    async def test_gateway_handoff_proxy_ws_and_revocation(self):
        for path, host in [
            ("/src/App.tsx", CREW),
            ("/api/state", SIM),
            ("/app.js", SIM),
            ("/__ui_hmr", CREW),
        ]:
            self.assertEqual((await self.request("GET", path, host)).status, 401)
        self.assertEqual(
            (await self.request("GET", "/", "elsewhere.example.test")).status, 421
        )
        self.assertEqual((await self.request("GET", "/webhook", SIM)).status, 404)
        self.assertEqual(
            (
                await self.request("POST", BASE + "/request", origin="https://" + SIM)
            ).status,
            403,
        )
        # Browser visits simulator first, starts a host-bound pending request and goes to Crew.
        start = await self.request("GET", BASE + "/login", SIM)
        binding = self.cookie(start, HANDOFF)
        location = urlsplit(start.headers["Location"])
        self.assertEqual(location.netloc, CREW)
        finished = await self.login(location.query)
        crew_cookie = self.cookie(finished, SESSION)
        document = await finished.text()
        self.assertIn("synthetic-reader-token", document)
        target = re.search(r'location.replace\("([^"]+)"\)', document)[1]
        callback = urlsplit(target)
        self.assertEqual(callback.netloc, SIM)
        path = callback.path + "?" + callback.query
        self.assertEqual((await self.request("GET", path, SIM)).status, 403)
        finish = await self.request("GET", path, SIM, cookie=binding)
        sim_cookie = self.cookie(finish, SESSION)
        self.assertNotIn("synthetic-reader-token", await finish.text())
        self.assertEqual(
            (await self.request("GET", path, SIM, cookie=binding)).status, 403
        )
        self.assertEqual(
            (await self.request("GET", "/app.js", SIM, cookie=crew_cookie)).status, 401
        )
        proxy = await self.request(
            "GET",
            "/api/read",
            cookie=crew_cookie,
            headers={
                "X-Forwarded-Proto": "http",
                "Authorization": "synthetic-reader-token",
            },
        )
        self.assertEqual(
            await proxy.json(),
            {
                "host": CREW,
                "proto": "https",
                "cookie": None,
                "auth": "synthetic-reader-token",
            },
        )
        for path in ("/webhook", "/api/other"):
            self.assertEqual(
                (
                    await self.request(
                        "POST", path, SIM, cookie=sim_cookie, origin="https://" + SIM
                    )
                ).status,
                404,
            )
        state = {"role": "specialist", "text": "Hello"}
        self.assertEqual(
            (
                await self.request(
                    "POST", "/api/chat", SIM, cookie=sim_cookie, json=state
                )
            ).status,
            403,
        )
        sent = await self.request(
            "POST",
            "/api/chat",
            SIM,
            cookie=sim_cookie,
            json=state,
            origin="https://" + SIM,
        )
        self.assertEqual(sent.status, 202)
        self.assertEqual(self.sim_events, [("chat", "specialist", "Hello")])
        ws = await self.client.ws_connect(
            "/__ui_hmr",
            headers={"Host": CREW, "Origin": "https://" + CREW, "Cookie": crew_cookie},
            protocols=["vite-hmr"],
        )
        await ws.send_str("ready")
        self.assertEqual((await ws.receive()).data, "hot ready")
        logout = await self.request(
            "POST", BASE + "/logout", SIM, cookie=sim_cookie, origin="https://" + SIM
        )
        self.assertEqual(logout.status, 303)
        self.assertEqual(
            (await asyncio.wait_for(ws.receive(), 2)).type, WSMsgType.CLOSE
        )
        await ws.close()
        self.assertEqual(
            (await self.request("GET", "/app.js", SIM, cookie=sim_cookie)).status, 401
        )
        self.assertEqual(
            (await self.request("GET", "/api/read", cookie=crew_cookie)).status, 401
        )
        cleanup = urlsplit(logout.headers["Location"])
        signed_out = await self.request("GET", cleanup.path + "?" + cleanup.query)
        self.assertIn(
            'localStorage.removeItem("pocketcontext.reader.auth")',
            await signed_out.text(),
        )

    async def test_only_configured_owner_can_finish(self):
        self.email = "other@example.test"
        finished = await self.login("")
        self.assertNotIn(SESSION, finished.cookies)
        self.assertNotIn("synthetic-reader-token", await finished.text())
