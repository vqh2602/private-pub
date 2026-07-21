"use client";

import { Badge } from "@private-pub/ui";
import {
  CheckCircle2,
  FileArchive,
  Loader2,
  PackagePlus,
  UploadCloud,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import styles from "./imports.module.css";

type ImportResult = {
  packageName: string;
  version: string;
  action: "package_created" | "version_added";
  message: string;
};

export default function ImportsPage() {
  const { locale } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError(
        locale === "en"
          ? "Please select a .tar.gz package file."
          : "Vui lòng chọn một file package .tar.gz.",
      );
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/registry/imports/file", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as ImportResult & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.message ||
            (locale === "en"
              ? "Unable to import package."
              : "Không thể import package."),
        );
      setResult(payload);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : locale === "en"
            ? "Unable to import package."
            : "Không thể import package.",
      );
    } finally {
      setLoading(false);
    }
  }

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setError("");
    setResult(null);
  }

  const activeStep = loading ? 2 : result ? 4 : 1;

  const steps =
    locale === "en"
      ? ["Choose file", "Verify", "Import", "Result"]
      : ["Chọn file", "Xác minh", "Import", "Kết quả"];

  return (
    <main className="subpage">
      <div className="content-shell compact-content">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Supply packages</span>
            <h1>Import from file</h1>
            <p>
              Upload một Dart/Flutter package archive để xác minh và đưa vào
              private registry.
            </p>
          </div>
          <Badge tone="blue">
            <UploadCloud size={13} />
            .tar.gz import
          </Badge>
        </div>
        <div className="wizard">
          <div className={`wizard-steps ${styles.wizardSteps}`}>
            {steps.map((label, index) => (
              <span
                key={label}
                className={activeStep >= index + 1 ? "active" : ""}
              >
                {index + 1} <i>{label}</i>
              </span>
            ))}
          </div>
          <form onSubmit={submit}>
            <label
              className={`${styles.archiveDropzone}${file ? ` ${styles.hasFile}` : ""}`}
            >
              <input
                ref={inputRef}
                type="file"
                name="file"
                accept=".tar.gz,application/gzip,application/x-gzip"
                onChange={(event) =>
                  selectFile(event.target.files?.[0] ?? null)
                }
                disabled={loading}
              />
              {file ? (
                <>
                  <FileArchive />
                  <strong>{file.name}</strong>
                  <span>
                    {formatBytes(file.size)} ·{" "}
                    {locale === "en" ? "Ready to verify" : "Sẵn sàng xác minh"}
                  </span>
                </>
              ) : (
                <>
                  <UploadCloud />
                  <strong>
                    {locale === "en"
                      ? "Choose a package archive"
                      : "Chọn package archive"}
                  </strong>
                  <span>
                    {locale === "en"
                      ? "Only .tar.gz files up to 100 MB are accepted"
                      : "Chỉ chấp nhận file .tar.gz, tối đa 100 MB"}
                  </span>
                </>
              )}
            </label>
            <div className={styles.importChecks}>
              <span>
                <CheckCircle2 />
                Kiểm tra cấu trúc archive và đường dẫn an toàn
              </span>
              <span>
                <CheckCircle2 />
                Đọc và xác minh pubspec.yaml
              </span>
              <span>
                <CheckCircle2 />
                Kiểm tra tên package, semantic version và SDK constraint
              </span>
              <span>
                <CheckCircle2 />
                Tính SHA-256 và lập chỉ mục file
              </span>
            </div>
            {loading && (
              <div className="validation-box">
                <Loader2 className="spin" />
                <div>
                  <strong>
                    {locale === "en"
                      ? "Verifying package"
                      : "Đang xác minh package"}
                  </strong>
                  <p>
                    {locale === "en"
                      ? "The archive is saved only after every validation passes."
                      : "Archive chỉ được lưu sau khi vượt qua toàn bộ bước kiểm tra."}
                  </p>
                </div>
              </div>
            )}
            {error && (
              <div className={`validation-box ${styles.validationError}`}>
                <XCircle />
                <div>
                  <strong>
                    {locale === "en" ? "Import failed" : "Import thất bại"}
                  </strong>
                  <p>{error}</p>
                </div>
              </div>
            )}
            {result && (
              <div className={`validation-box ${styles.validationSuccess}`}>
                <PackagePlus />
                <div>
                  <strong>
                    {result.action === "package_created"
                      ? locale === "en"
                        ? "New package created"
                        : "Đã tạo package mới"
                      : locale === "en"
                        ? "New version added"
                        : "Đã thêm version mới"}
                  </strong>
                  <p>{result.message}</p>
                  <Link
                    href={`/packages/${encodeURIComponent(result.packageName)}`}
                  >
                    {locale === "en" ? "View" : "Xem"} {result.packageName} →
                  </Link>
                </div>
              </div>
            )}
            <div className="form-actions">
              {file && !loading && (
                <button
                  type="button"
                  onClick={() => {
                    selectFile(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                >
                  {locale === "en" ? "Choose again" : "Chọn lại"}
                </button>
              )}
              <button className="primary" disabled={!file || loading}>
                {loading ? <Loader2 className="spin" /> : <UploadCloud />}
                {locale === "en" ? "Verify & import" : "Xác minh & import"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
