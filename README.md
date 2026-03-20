# MCP Explorer

A web-based GUI for exploring and interacting with [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers. Connect to any MCP server, browse its capabilities, and execute tools, read resources, and test prompts — all from your browser.

![Python 3.13+](https://img.shields.io/badge/python-3.13%2B-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

## Features

- **Connect to any MCP server** — supports both Streamable HTTP and SSE transports (auto-detects)
- **Authentication** — Bearer token, custom header, or no auth
- **Browse Tools** — list all tools, view schemas, fill in parameters, and execute them
- **Browse Resources** — list and read resources exposed by the server
- **Browse Prompts** — list prompts, fill in arguments, and retrieve rendered output
- **Parameter Store** — save and reuse frequently used parameter values across sessions
- **URL History** — remembers previously connected server URLs
- **Clean UI** — minimal, responsive interface with tabbed navigation

## Quick Start

### Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

### Install & Run

```bash
# Clone the repo
git clone https://github.com/ventz/mcp-explorer.git
cd mcp-explorer

# Install dependencies
uv sync

# Run the server
uv run python app.py
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

### Using pip

```bash
pip install fastapi 'uvicorn[standard]' jinja2 mcp
python app.py
```

## Usage

1. Enter an MCP server URL (e.g., `http://localhost:3000/mcp`)
2. Optionally configure authentication (Bearer token or custom header)
3. Click **Connect**
4. Use the tabs to explore **Tools**, **Resources**, and **Prompts**
5. Select an item to view its details, fill in parameters, and execute

## Project Structure

```
mcp-explorer/
├── app.py              # FastAPI backend — MCP client + API routes
├── pyproject.toml       # Python project metadata & dependencies
├── templates/
│   └── index.html       # Main HTML template
└── static/
    ├── app.js           # Frontend application logic
    └── style.css        # Styles
```

## API Endpoints

| Method | Path                | Description                  |
|--------|---------------------|------------------------------|
| GET    | `/`                 | Web UI                       |
| POST   | `/api/connect`      | Connect to an MCP server     |
| POST   | `/api/disconnect`   | Disconnect                   |
| GET    | `/api/status`       | Connection status             |
| GET    | `/api/tools`        | List available tools         |
| POST   | `/api/tools/call`   | Execute a tool               |
| GET    | `/api/resources`    | List available resources     |
| POST   | `/api/resources/read` | Read a resource            |
| GET    | `/api/prompts`      | List available prompts       |
| POST   | `/api/prompts/get`  | Get a rendered prompt        |

## License

MIT
