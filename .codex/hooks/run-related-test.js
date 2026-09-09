#!/usr/bin/env node
// PostToolUse: after an Edit/Write to feldmark_app/server/<name>.js, run the
// matching server/<name>.test.js via `node --test` if one exists. Silent
// no-op for files with no matching test, and for edits to a test file itself.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

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

  const match = filePath.match(/feldmark_app\/server\/([^/]+)\.js$/);
  if (!match) process.exit(0);

  const name = match[1];
  if (name.endsWith(".test")) process.exit(0);

  const projectRoot = path.resolve(__dirname, "..", "..", "feldmark_app");
  const testFile = path.join(projectRoot, "server", `${name}.test.js`);
  if (!fs.existsSync(testFile)) process.exit(0);

  let output;
  let passed = true;
  try {
    output = execFileSync("node", ["--test", `server/${name}.test.js`], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    passed = false;
    output = (err.stdout || "") + (err.stderr || "");
  }

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          `node --test server/${name}.test.js ${passed ? "passed" : "FAILED"}:\n` +
          output.slice(-4000),
      },
    })
  );
});
