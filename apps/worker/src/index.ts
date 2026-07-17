import { runPipeline } from "./pipeline.js";

console.info(JSON.stringify({ service: "private-pub-worker", status: "ready", mode: process.env.MOCK_ANALYZER === "false" ? "sdk" : "mock" }));

// The local worker proves the pipeline without requiring Redis. Production deployment
// wires this handler to a durable queue adapter and gives each job an isolated workspace.
if (process.env.RUN_SAMPLE_JOB === "true") {
  const result = await runPipeline({ packageName: "aurora_ui", version: "2.3.1", workDir: process.cwd(), isFlutter: true });
  console.info(JSON.stringify(result, null, 2));
}

setInterval(() => console.info(JSON.stringify({ service: "private-pub-worker", heartbeat: new Date().toISOString() })), 60_000);
