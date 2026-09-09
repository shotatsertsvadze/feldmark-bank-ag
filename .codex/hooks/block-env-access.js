#!/usr/bin/env node
// PreToolUse guard: blocks Read/Edit/Write on feldmark_app/.env.
// That file holds DATABASE_URL (with the DB password) and MISTRAL_API_KEY -
// it must never land in a transcript or get overwritten with the wrong
// (non-pooler) connection string copied from .env.example.

const path = require("path");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const filePath = payload.tool_input && payload.tool_input.file_path;
  if (!filePath) process.exit(0);

  if (path.basename(filePath) !== ".env") process.exit(0);

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Blocked: feldmark_app/.env holds DATABASE_URL (with the DB password) and MISTRAL_API_KEY. " +
          "Never read, edit, or overwrite it directly - see .env.example for the documented shape and CLAUDE.md " +
          "for the required Session Pooler connection string.",
      },
    })
  );
});
