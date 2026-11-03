# OpenStudy Study MCP Setup

Tools: `generate_quiz`, `explain_concept`, `make_flashcards`, `get_study_plan`, `grade_answer`. They share the web chat's quality pipeline (see `question-quality.md`).

This is separate from `/api/mcp`, the token-protected owner analytics server, which is unchanged.

- HTTP: `https://<deployment>/mcp` (streamable HTTP)
- Stdio: `npm --prefix <repo>/web run -s mcp:stdio`
- Widgets: `ui://openstudy/quiz.html`, `flashcards.html`, `explanation.html`, served as `text/html;profile=mcp-app` and linked with `_meta.ui.resourceUri` plus the `openai/outputTemplate` alias. They are self-contained, with no network access.

This server is not published to any directory.

## Keys

No key is required. With none, every tool runs in labelled Demo mode, covering Quadratic Functions, Derivatives, Compound Interest, Photosynthesis, and Supply And Demand. Unknown topics say so instead of inventing content.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Live model. Or `OPENSTUDY_AI_GATEWAY=1` with `AI_GATEWAY_API_KEY`, or the deployment's OIDC token once the Vercel team has a card on file. |
| `OPENSTUDY_STUDY_MCP_TOKEN` | Optional. Over HTTP the model is only used for callers sending `Authorization: Bearer <token>`. Everyone else gets Demo mode, so a public URL cannot run up a bill. |
| `OPENSTUDY_STUDY_MCP_PUBLIC_AI` | Optional. `1` lets all HTTP callers use the model. ChatGPT connectors offer OAuth or no auth, not a static bearer token, so this is what a live model in ChatGPT needs until OAuth is added. Set a spend limit first. |

The web chat at `/api/chat` uses the model whenever a key is configured, like the existing `/api/ask`. Stdio always uses a local key if present.

## MCP Inspector

```bash
npx @modelcontextprotocol/inspector --cli https://<deployment>/mcp --transport http --method tools/list
npx @modelcontextprotocol/inspector --cli https://<deployment>/mcp --transport http --method tools/call --tool-name generate_quiz --tool-arg topic=derivatives --tool-arg count=2
```

Leave off `--cli` for the browser UI. To exercise every tool end to end, from `web/`:

```bash
npm run -s mcp:exercise -- http http://localhost:3000/mcp
npm run -s mcp:exercise -- stdio
```

## ChatGPT

ChatGPT needs a public HTTPS URL it can reach without a login. A Vercel preview behind Deployment Protection returns a login page, so use production, a deployment without protection, or a tunnel such as `cloudflared tunnel --url http://localhost:3000`.

1. In ChatGPT settings, open the apps or connectors section, then Advanced, and turn on developer mode. OpenAI renames this area often, so follow its current "connect and test" docs if the labels differ.
2. Create a new connector with the URL ending in `/mcp` and no authentication.
3. In a chat, enable the connector and ask "Quiz me on derivatives". The quiz renders inline as a widget.

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` and restart Claude Desktop:

```json
{
  "mcpServers": {
    "openstudy": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/openstudy/web", "run", "-s", "mcp:stdio"],
      "env": { "ANTHROPIC_API_KEY": "optional" }
    }
  }
}
```

Run `npm install` in `web/` first. If Claude Desktop cannot find `npm`, use its absolute path from `which npm`. Leave out `env` for Demo mode.
