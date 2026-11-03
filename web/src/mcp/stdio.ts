// Stdio transport for Claude Desktop and local inspectors. Runs with the local key if there is one,
// otherwise Demo mode. Never write to stdout here: it carries the protocol.
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { tutorAi } from "@/lib/server/tutor-ai";
import { INSTRUCTIONS, registerStudyTools, SERVER_INFO } from "./tools";

serveStdio(() => {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerStudyTools(server, tutorAi());
  return server;
});
