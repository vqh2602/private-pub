import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createReadStream } from "node:fs";
import tar from "tar-stream";

export async function extractTarGz(archive: string, targetDir: string): Promise<void> {
  const extract = tar.extract();
  await new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const sanitizedPath = header.name.replaceAll("\\", "/").replace(/^\.\//, "");
      if (sanitizedPath.includes("..") || sanitizedPath.startsWith("/")) {
        stream.resume();
        return next();
      }
      const filePath = join(targetDir, sanitizedPath);
      if (header.type === "directory") {
        mkdir(filePath, { recursive: true })
          .then(() => {
            stream.resume();
            next();
          })
          .catch(next);
      } else if (header.type === "file") {
        mkdir(dirname(filePath), { recursive: true })
          .then(() => {
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => {
              writeFile(filePath, Buffer.concat(chunks))
                .then(() => next())
                .catch(next);
            });
            stream.resume();
          })
          .catch(next);
      } else {
        stream.resume();
        next();
      }
    });

    const inputStream = createReadStream(archive);

    pipeline(inputStream, createGunzip(), extract)
      .then(() => resolve())
      .catch(reject);
  });
}
