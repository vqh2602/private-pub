import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "./pipeline.js";
import { extractTarGz } from "./archive.js";
import { PrismaClient } from "@private-pub/database";

const prisma = new PrismaClient();

console.info(
  JSON.stringify({
    service: "private-pub-worker",
    status: "ready",
    mode: process.env.MOCK_ANALYZER === "false" ? "sdk" : "mock",
  }),
);

async function poll() {
  try {
    const run = await prisma.analysisRun.findFirst({
      where: { status: "QUEUED" },
      include: {
        version: {
          include: {
            package: true,
          },
        },
      },
      orderBy: { id: "asc" },
    });
    if (!run) return;

    // Mark as RUNNING
    await prisma.analysisRun.update({
      where: { id: run.id },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    console.info(
      `[Worker] Started analysis for ${run.version.package.name} v${run.version.version}`,
    );

    let tempDir = "";
    try {
      tempDir = await mkdtemp(join(tmpdir(), "private-pub-worker-analysis-"));

      const archivePath = run.version.archiveObjectKey;
      await extractTarGz(archivePath, tempDir);

      const pubspec = run.version.pubspecJson as Record<string, any>;
      const dependencies =
        pubspec.dependencies &&
        typeof pubspec.dependencies === "object" &&
        !Array.isArray(pubspec.dependencies)
          ? pubspec.dependencies
          : {};
      const environment =
        pubspec.environment &&
        typeof pubspec.environment === "object" &&
        !Array.isArray(pubspec.environment)
          ? pubspec.environment
          : {};
      const isFlutter = Boolean(
        dependencies.flutter || environment.flutter || pubspec.flutter,
      );

      const result = await runPipeline(
        {
          packageName: run.version.package.name,
          version: run.version.version,
          workDir: tempDir,
          isFlutter,
        },
        process.env.MOCK_ANALYZER !== "false",
      );

      // Save findings and update Score
      await prisma.$transaction(async (tx) => {
        // Delete any existing findings for this run
        await tx.analysisFinding.deleteMany({
          where: { analysisRunId: run.id },
        });

        // Insert new findings
        const findingsData = [];
        for (const step of result.steps) {
          for (const finding of step.findings) {
            findingsData.push({
              analysisRunId: run.id,
              category: finding.category,
              severity: finding.severity.toUpperCase(),
              title: finding.title,
              message: finding.message,
            });
          }
        }

        if (findingsData.length) {
          await tx.analysisFinding.createMany({
            data: findingsData,
          });
        }

        // Update AnalysisRun
        await tx.analysisRun.update({
          where: { id: run.id },
          data: {
            status: result.status === "completed" ? "COMPLETED" : "FAILED",
            endedAt: new Date(),
            panaVersion: "0.22.0",
          },
        });

        // Update Score
        const tags = ["sdk:dart"];
        if (isFlutter) {
          tags.push("sdk:flutter");
          tags.push(
            "platform:android",
            "platform:ios",
            "platform:web",
            "platform:linux",
            "platform:macos",
            "platform:windows",
          );
        }

        const scoreData = {
          grantedPoints: result.score.grantedPoints,
          maxPoints: result.score.maxPoints,
          qualityScore: result.score.qualityScore,
          popularityScore: result.score.popularityScore,
          maintenanceScore: result.score.maintenanceScore,
          tagsJson: tags,
          weightsJson: result.score.weights,
          breakdownJson: result.steps.map((s) => ({
            label: s.step,
            points:
              s.status === "passed" ? 30 : s.status === "warning" ? 20 : 0,
            max: 30,
            status:
              s.status === "passed"
                ? "pass"
                : s.status === "warning"
                  ? "warn"
                  : "fail",
            details: s.findings.map(
              (f) => `${f.severity.toUpperCase()}: ${f.title} - ${f.message}`,
            ),
          })),
        };

        const existingScore = await tx.score.findFirst({
          where: { packageVersionId: run.packageVersionId },
        });

        if (existingScore) {
          await tx.score.update({
            where: { id: existingScore.id },
            data: scoreData,
          });
        } else {
          await tx.score.create({
            data: {
              packageVersionId: run.packageVersionId,
              ...scoreData,
            },
          });
        }
      });

      console.info(
        `[Worker] Finished analysis for ${run.version.package.name} v${run.version.version}. Score: ${result.score.grantedPoints}/${result.score.maxPoints}`,
      );
    } catch (err) {
      console.error(
        `[Worker] Failed analysis for ${run.version.package.name} v${run.version.version}:`,
        err,
      );
      await prisma.analysisRun
        .update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            endedAt: new Date(),
          },
        })
        .catch(() => {});
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch (dbErr) {
    console.error("[Worker] Polling database error:", dbErr);
  }
}

// Start polling loop
const pollInterval = setInterval(poll, 3000);

// Heartbeat log
const heartbeatInterval = setInterval(
  () =>
    console.info(
      JSON.stringify({
        service: "private-pub-worker",
        heartbeat: new Date().toISOString(),
      }),
    ),
  60_000,
);

// Graceful shutdown
process.on("SIGINT", () => {
  clearInterval(pollInterval);
  clearInterval(heartbeatInterval);
  prisma.$disconnect().then(() => process.exit(0));
});
