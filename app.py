import asyncio
import json
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anyio
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from mcp.client.sse import sse_client
from mcp.shared.exceptions import McpError

logger = logging.getLogger("mcp-explorer")

BASE_DIR = Path(__file__).parent


@dataclass
class ConnectionState:
    session: ClientSession | None = None
    server_info: dict | None = None
    capabilities: dict | None = None
    connected: bool = False
    error: str | None = None
    _disconnect_event: anyio.Event | None = None
    _task_group: anyio.abc.TaskGroup | None = None


state = ConnectionState()


async def _run_streamable_http(url: str, headers: dict[str, str]) -> None:
    async with streamablehttp_client(url, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            init_result = await session.initialize()
            state.session = session
            info = init_result.serverInfo
            state.server_info = info.model_dump(mode="json") if info else None
            caps = init_result.capabilities
            state.capabilities = caps.model_dump(mode="json") if caps else None
            state.connected = True
            state.error = None
            await state._disconnect_event.wait()


async def _run_sse(url: str, headers: dict[str, str]) -> None:
    async with sse_client(url, headers=headers) as (read, write):
        async with ClientSession(read, write) as session:
            init_result = await session.initialize()
            state.session = session
            info = init_result.serverInfo
            state.server_info = info.model_dump(mode="json") if info else None
            caps = init_result.capabilities
            state.capabilities = caps.model_dump(mode="json") if caps else None
            state.connected = True
            state.error = None
            await state._disconnect_event.wait()


async def _connect(url: str, headers: dict[str, str]) -> None:
    try:
        await _run_streamable_http(url, headers)
    except Exception:
        logger.info("StreamableHTTP failed, falling back to SSE")
        try:
            await _run_sse(url, headers)
        except Exception as e:
            state.error = str(e)
            state.connected = False
            state.session = None
            state.server_info = None
            logger.exception("Both transports failed")


async def _disconnect() -> None:
    if state._disconnect_event:
        state._disconnect_event.set()
    # Give the background task a moment to clean up
    await anyio.sleep(0.3)
    state.session = None
    state.server_info = None
    state.capabilities = None
    state.connected = False
    state.error = None
    state._disconnect_event = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Clean up on shutdown
    if state.connected:
        await _disconnect()


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/api/connect")
async def api_connect(request: Request):
    body = await request.json()
    url = body.get("url", "").strip()
    auth_type = body.get("auth_type", "none")
    auth_value = body.get("auth_value", "")
    header_name = body.get("header_name", "")

    if not url:
        return JSONResponse({"error": "URL is required"}, status_code=400)

    # Disconnect existing connection first
    if state.connected:
        await _disconnect()

    headers: dict[str, str] = {}
    if auth_type == "bearer" and auth_value:
        headers["Authorization"] = f"Bearer {auth_value}"
    elif auth_type == "header" and header_name and auth_value:
        headers[header_name] = auth_value

    state._disconnect_event = anyio.Event()

    # Run connection in a background task so it persists
    async def run():
        await _connect(url, headers)

    # We need to use a task group that outlives this request
    task = asyncio.create_task(run())

    # Wait for connection to establish (or fail)
    for _ in range(100):  # up to 10 seconds
        await anyio.sleep(0.1)
        if state.connected or state.error:
            break

    if state.error:
        return JSONResponse({"error": state.error}, status_code=502)
    if not state.connected:
        return JSONResponse({"error": "Connection timed out"}, status_code=504)

    return {"status": "connected", "server_info": state.server_info}


@app.post("/api/disconnect")
async def api_disconnect():
    if not state.connected:
        return {"status": "already disconnected"}
    await _disconnect()
    return {"status": "disconnected"}


@app.get("/api/status")
async def api_status():
    return {
        "connected": state.connected,
        "server_info": state.server_info,
        "capabilities": state.capabilities,
        "error": state.error,
    }


def _ensure_connected():
    if not state.session or not state.connected:
        return JSONResponse({"error": "Not connected"}, status_code=400)
    return None


def _has_capability(name: str) -> bool:
    if not state.capabilities:
        return False
    return state.capabilities.get(name) is not None


@app.get("/api/tools")
async def api_tools():
    err = _ensure_connected()
    if err:
        return err
    if not _has_capability("tools"):
        return {"tools": []}
    try:
        result = await state.session.list_tools()
        tools = [t.model_dump(mode="json") for t in result.tools]
        return {"tools": tools}
    except McpError as e:
        return {"tools": [], "error": str(e)}


@app.post("/api/tools/call")
async def api_tools_call(request: Request):
    err = _ensure_connected()
    if err:
        return err
    body = await request.json()
    name = body.get("name")
    arguments = body.get("arguments", {})
    if not name:
        return JSONResponse({"error": "Tool name is required"}, status_code=400)
    try:
        result = await state.session.call_tool(name, arguments)
        return result.model_dump(mode="json")
    except McpError as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/resources")
async def api_resources():
    err = _ensure_connected()
    if err:
        return err
    if not _has_capability("resources"):
        return {"resources": []}
    try:
        result = await state.session.list_resources()
        resources = [r.model_dump(mode="json") for r in result.resources]
        return {"resources": resources}
    except McpError as e:
        return {"resources": [], "error": str(e)}


@app.post("/api/resources/read")
async def api_resources_read(request: Request):
    err = _ensure_connected()
    if err:
        return err
    body = await request.json()
    uri = body.get("uri")
    if not uri:
        return JSONResponse({"error": "Resource URI is required"}, status_code=400)
    try:
        result = await state.session.read_resource(uri)
        return result.model_dump(mode="json")
    except McpError as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/prompts")
async def api_prompts():
    err = _ensure_connected()
    if err:
        return err
    if not _has_capability("prompts"):
        return {"prompts": []}
    try:
        result = await state.session.list_prompts()
        prompts = [p.model_dump(mode="json") for p in result.prompts]
        return {"prompts": prompts}
    except McpError as e:
        return {"prompts": [], "error": str(e)}


@app.post("/api/prompts/get")
async def api_prompts_get(request: Request):
    err = _ensure_connected()
    if err:
        return err
    body = await request.json()
    name = body.get("name")
    arguments = body.get("arguments", {})
    if not name:
        return JSONResponse({"error": "Prompt name is required"}, status_code=400)
    try:
        result = await state.session.get_prompt(name, arguments)
        return result.model_dump(mode="json")
    except McpError as e:
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
