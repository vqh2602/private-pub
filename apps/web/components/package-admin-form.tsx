"use client";

import type { AccountRole, PackageDetail } from "@private-pub/contracts";
import { Badge } from "@private-pub/ui";
import {
  CheckCircle2,
  LoaderCircle,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";

interface Collaborator {
  subjectId: string;
  subjectType: string;
  role: "PACKAGE_ADMIN" | "PACKAGE_WRITER" | "VIEWER";
  username?: string;
  grantedAt: string;
  grantedBy: string;
}

export function PackageAdminForm({
  name,
  detail,
}: {
  name: string;
  detail: PackageDetail;
}) {
  const { locale } = useLanguage();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    username: string;
    role: AccountRole;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<
    "PACKAGE_ADMIN" | "PACKAGE_WRITER" | "VIEWER"
  >("PACKAGE_WRITER");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDiscontinued, setIsDiscontinued] = useState(
    detail.package.isDiscontinued,
  );
  const [recomputesLoading, setRecomputesLoading] = useState(false);
  const [discontinueLoading, setDiscontinueLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [collaboratorsResponse, meResponse] = await Promise.all([
        fetch(`/api/registry/packages/${name}/permissions`, {
          cache: "no-store",
        }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);
      if (meResponse.ok) {
        const data = await meResponse.json();
        setCurrentUser(data.user);
      }
      if (collaboratorsResponse.ok) {
        const data = await collaboratorsResponse.json();
        setCollaborators(data.items || []);
      } else {
        setError(
          locale === "en"
            ? "Unable to load collaborators."
            : "Không thể tải danh sách cộng tác viên.",
        );
      }
    } catch {
      setError(
        locale === "en"
          ? "Unable to load collaborators."
          : "Không thể tải danh sách cộng tác viên.",
      );
    } finally {
      setLoading(false);
    }
  }, [name, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const creatorId = detail.package.creatorId;
  const creatorRole = detail.package.creatorRole;

  const isActorAdmin =
    currentUser?.role === "admin" || currentUser?.role === "super_admin";
  const isCreator = currentUser && creatorId === currentUser.id;
  const hasPackageAdminRole =
    currentUser &&
    collaborators.some(
      (c) => c.subjectId === currentUser.id && c.role === "PACKAGE_ADMIN",
    );

  const isCreatorAdmin =
    creatorRole === "admin" || creatorRole === "super_admin";

  const isAuthorized = isCreatorAdmin
    ? isActorAdmin
    : isActorAdmin || isCreator || hasPackageAdminRole;

  async function addCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `/api/registry/packages/${name}/permissions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, role }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          payload.message ??
            (response.status === 404
              ? locale === "en"
                ? `User "${username}" does not exist.`
                : `Người dùng "${username}" không tồn tại.`
              : locale === "en"
                ? "Unable to add collaborator."
                : "Không thể thêm cộng tác viên."),
        );
        setLoading(false);
        return;
      }
      setSuccess(
        locale === "en"
          ? `Successfully added "${username}" as a collaborator.`
          : `Đã thêm cộng tác viên "${username}" thành công.`,
      );
      setUsername("");
      setOpen(false);
      await load();
    } catch {
      setError(
        locale === "en"
          ? "Unable to add collaborator."
          : "Không thể thêm cộng tác viên.",
      );
      setLoading(false);
    }
  }

  async function revokeCollaborator(
    subjectId: string,
    collaboratorUsername: string,
  ) {
    const confirmMessage =
      locale === "en"
        ? `Are you sure you want to revoke permissions for "${collaboratorUsername}"?`
        : `Bạn có chắc chắn muốn thu hồi quyền của "${collaboratorUsername}" không?`;
    if (!window.confirm(confirmMessage)) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `/api/registry/packages/${name}/permissions/${subjectId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(
          payload.message ??
            (locale === "en"
              ? "Unable to revoke collaborator permissions."
              : "Không thể thu hồi quyền cộng tác viên."),
        );
        setLoading(false);
        return;
      }
      setSuccess(
        locale === "en"
          ? `Successfully revoked permissions for "${collaboratorUsername}".`
          : `Đã thu hồi quyền của "${collaboratorUsername}" thành công.`,
      );
      await load();
    } catch {
      setError(
        locale === "en"
          ? "Unable to revoke collaborator permissions."
          : "Không thể thu hồi quyền cộng tác viên.",
      );
      setLoading(false);
    }
  }

  async function queueAnalysis() {
    setRecomputesLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/registry/packages/${name}/recompute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          package: name,
          version: detail.latestVersion.version,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(
          payload.message ??
            (locale === "en"
              ? "Unable to queue analysis."
              : "Không thể yêu cầu phân tích."),
        );
        return;
      }
      setSuccess(
        locale === "en"
          ? "Analysis queued successfully. Refresh in a moment to see the updated scores."
          : "Đã yêu cầu phân tích thành công. Vui lòng làm mới trang sau ít phút để xem điểm số mới.",
      );
    } catch {
      setError(
        locale === "en"
          ? "Unable to queue analysis."
          : "Không thể yêu cầu phân tích.",
      );
    } finally {
      setRecomputesLoading(false);
    }
  }

  async function toggleDiscontinue() {
    const nextState = !isDiscontinued;
    const confirmMessage = nextState
      ? locale === "en"
        ? `Are you sure you want to discontinue "${name}"?`
        : `Bạn có chắc chắn muốn ngừng phát triển "${name}" không?`
      : locale === "en"
        ? `Are you sure you want to undiscontinue "${name}"?`
        : `Bạn có chắc chắn muốn hủy ngừng phát triển "${name}" không?`;

    if (!window.confirm(confirmMessage)) return;

    setDiscontinueLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const endpoint = nextState ? "discontinue" : "undiscontinue";
      const response = await fetch(
        `/api/registry/packages/${name}/${endpoint}`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(
          payload.message ??
            (locale === "en"
              ? `Unable to update package status.`
              : `Không thể cập nhật trạng thái package.`),
        );
        return;
      }
      setIsDiscontinued(nextState);
      setSuccess(
        nextState
          ? locale === "en"
            ? `Package "${name}" has been discontinued.`
            : `Package "${name}" đã được ngừng phát triển thành công.`
          : locale === "en"
            ? `Package "${name}" is now active.`
            : `Package "${name}" đã được hủy ngừng phát triển thành công.`,
      );
    } catch {
      setError(
        locale === "en"
          ? "Unable to update package status."
          : "Không thể cập nhật trạng thái package.",
      );
    } finally {
      setDiscontinueLoading(false);
    }
  }

  return (
    <div
      className="admin-package"
      style={{ display: "flex", flexDirection: "column", gap: "28px" }}
    >
      <div>
        <span className="eyebrow">
          {locale === "en" ? "Package controls" : "Điều khiển gói"}
        </span>
        <h2>{locale === "en" ? "Administration" : "Quản trị gói"}</h2>
        <p style={{ marginBottom: 0 }}>
          {locale === "en"
            ? "High-impact actions are protected by package-admin permissions and recorded in the audit log."
            : "Các hành động tác động lớn được bảo vệ bằng quyền quản trị gói và được ghi lại trong nhật ký kiểm toán."}
        </p>
      </div>

      {/* Collaborators & Permissions Section */}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: "24px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: "16px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Users size={18} />
              {locale === "en"
                ? "Collaborators & Permissions"
                : "Cộng tác viên & Phân quyền"}
            </h3>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "12px",
                color: "var(--muted)",
              }}
            >
              {creatorRole
                ? locale === "en"
                  ? `This package was uploaded by an ${creatorRole === "user" ? "user" : "admin"}.`
                  : `Gói này được tải lên bởi ${creatorRole === "user" ? "Người dùng thường" : "Quản trị viên"}.`
                : locale === "en"
                  ? "Package uploader details are not registered."
                  : "Thông tin người tải lên chưa được đăng ký."}
            </p>
          </div>
          {isAuthorized && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setOpen((value) => !value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--line)",
                background: "var(--surface)",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              {open ? <X size={14} /> : <Plus size={14} />}
              {open
                ? locale === "en"
                  ? "Close"
                  : "Đóng"
                : locale === "en"
                  ? "Add Collaborator"
                  : "Thêm cộng tác viên"}
            </button>
          )}
        </div>

        {error && (
          <div
            className="alert alert-danger"
            style={{
              color: "var(--red)",
              background: "rgba(239, 68, 68, 0.1)",
              padding: "12px",
              borderRadius: "8px",
              fontSize: "13px",
              marginBottom: "16px",
            }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            className="alert alert-success"
            style={{
              color: "var(--green)",
              background: "rgba(34, 197, 94, 0.1)",
              padding: "12px",
              borderRadius: "8px",
              fontSize: "13px",
              marginBottom: "16px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <CheckCircle2 size={16} />
            {success}
          </div>
        )}

        {open && isAuthorized && (
          <form
            onSubmit={addCollaborator}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              background: "rgba(255, 255, 255, 0.02)",
              padding: "16px",
              borderRadius: "8px",
              border: "1px solid var(--line)",
              marginBottom: "16px",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 150px",
                gap: "12px",
              }}
            >
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                {locale === "en" ? "Username" : "Tên đăng nhập"}
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  required
                  placeholder={
                    locale === "en"
                      ? "Enter username..."
                      : "Nhập tên đăng nhập..."
                  }
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--line)",
                    background: "var(--bg)",
                    color: "var(--text)",
                  }}
                />
              </label>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                {locale === "en" ? "Role" : "Vai trò"}
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as any)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--line)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    height: "38px",
                  }}
                >
                  <option value="PACKAGE_WRITER">
                    {locale === "en"
                      ? "Writer (Publish only)"
                      : "Writer (Chỉ xuất bản)"}
                  </option>
                  <option value="PACKAGE_ADMIN">
                    {locale === "en"
                      ? "Admin (Publish & Manage)"
                      : "Admin (Xuất bản & Quản lý)"}
                  </option>
                </select>
              </label>
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{
                alignSelf: "flex-end",
                padding: "8px 16px",
                borderRadius: "6px",
                background: "var(--blue)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {loading && <LoaderCircle size={14} className="animate-spin" />}
              {locale === "en" ? "Add Collaborator" : "Thêm cộng tác viên"}
            </button>
          </form>
        )}

        {loading && collaborators.length === 0 ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "24px 0",
            }}
          >
            <LoaderCircle
              className="animate-spin"
              style={{ color: "var(--muted)" }}
            />
          </div>
        ) : collaborators.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "24px 0",
              color: "var(--muted)",
              fontSize: "13px",
            }}
          >
            {locale === "en"
              ? "No collaborators added yet."
              : "Chưa có cộng tác viên nào được thêm."}
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "13px",
              marginTop: "8px",
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid var(--line)",
                  color: "var(--muted)",
                }}
              >
                <th style={{ padding: "8px 12px" }}>
                  {locale === "en" ? "User" : "Người dùng"}
                </th>
                <th style={{ padding: "8px 12px" }}>
                  {locale === "en" ? "Role" : "Vai trò"}
                </th>
                <th style={{ padding: "8px 12px" }}>
                  {locale === "en" ? "Granted By" : "Cấp bởi"}
                </th>
                {isAuthorized && (
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>
                    {locale === "en" ? "Actions" : "Hành động"}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {collaborators.map((c) => {
                const isUploader = c.subjectId === creatorId;
                const canRevoke =
                  isAuthorized &&
                  !isUploader &&
                  (c.subjectId !== currentUser?.id ||
                    collaborators.filter((p) => p.role === "PACKAGE_ADMIN")
                      .length > 1);

                return (
                  <tr
                    key={c.subjectId}
                    style={{
                      borderBottom: "1px solid var(--line)",
                      background: "rgba(255, 255, 255, 0.01)",
                    }}
                  >
                    <td style={{ padding: "12px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>
                          {c.username || c.subjectId}
                        </span>
                        {isUploader && (
                          <Badge tone="blue" style={{ fontSize: "10px" }}>
                            {locale === "en" ? "Creator" : "Người tạo"}
                          </Badge>
                        )}
                        {c.subjectId === currentUser?.id && (
                          <Badge tone="green" style={{ fontSize: "10px" }}>
                            {locale === "en" ? "You" : "Bạn"}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <Badge
                        tone={c.role === "PACKAGE_ADMIN" ? "blue" : "neutral"}
                      >
                        {c.role === "PACKAGE_ADMIN" ? "Admin" : "Writer"}
                      </Badge>
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        color: "var(--muted)",
                        fontSize: "12px",
                      }}
                    >
                      {c.grantedBy}
                    </td>
                    {isAuthorized && (
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {canRevoke ? (
                          <button
                            type="button"
                            onClick={() =>
                              revokeCollaborator(
                                c.subjectId,
                                c.username || c.subjectId,
                              )
                            }
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--red)",
                              cursor: "pointer",
                              padding: "4px",
                              borderRadius: "4px",
                            }}
                            title={
                              locale === "en"
                                ? "Revoke permissions"
                                : "Thu hồi quyền"
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        ) : (
                          <span
                            style={{ color: "var(--muted)", fontSize: "11px" }}
                          >
                            -
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {!isAuthorized && (
          <div
            style={{
              color: "var(--muted)",
              background: "rgba(255, 255, 255, 0.02)",
              padding: "12px",
              borderRadius: "8px",
              fontSize: "13px",
              marginTop: "16px",
              border: "1px dashed var(--line)",
            }}
          >
            {locale === "en"
              ? "You do not have administrative privileges to manage collaborator permissions for this package."
              : "Bạn không có quyền quản trị để quản lý cộng tác viên và phân quyền cho package này."}
          </div>
        )}
      </div>

      {/* Danger Zone (Existing Controls) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          borderTop: "1px solid var(--line)",
          paddingTop: "24px",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "16px",
            fontWeight: 600,
            color: "var(--red)",
          }}
        >
          {locale === "en" ? "Danger Zone" : "Khu vực nguy hiểm"}
        </h3>
        <div
          className="danger-row"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <strong>
              {locale === "en"
                ? "Recompute analysis"
                : "Tính toán lại phân tích"}
            </strong>
            <p>
              {locale === "en"
                ? "Queue a fresh analysis and score run."
                : "Xếp hàng phân tích mới và chạy lại điểm số."}
            </p>
          </div>
          <button
            onClick={queueAnalysis}
            disabled={recomputesLoading}
            style={{
              cursor: recomputesLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {recomputesLoading && (
              <LoaderCircle size={14} className="animate-spin" />
            )}
            {locale === "en" ? "Queue analysis" : "Yêu cầu phân tích"}
          </button>
        </div>
        <div
          className="danger-row"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <strong>
              {isDiscontinued
                ? locale === "en"
                  ? "Undiscontinue package"
                  : "Hủy ngừng phát triển gói"
                : locale === "en"
                  ? `Discontinue ${name}`
                  : `Ngừng phát triển ${name}`}
            </strong>
            <p>
              {isDiscontinued
                ? locale === "en"
                  ? "Remove the discontinued badge and restore normal listing."
                  : "Loại bỏ nhãn ngừng phát triển và khôi phục hiển thị bình thường."
                : locale === "en"
                  ? "Keep versions available while directing users to a replacement."
                  : "Giữ các phiên bản cũ trong khi hướng người dùng sang gói thay thế."}
            </p>
          </div>
          <button
            className={isDiscontinued ? "secondary-button" : "danger"}
            onClick={toggleDiscontinue}
            disabled={discontinueLoading}
            style={{
              cursor: discontinueLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {discontinueLoading && (
              <LoaderCircle size={14} className="animate-spin" />
            )}
            {isDiscontinued
              ? locale === "en"
                ? "Undiscontinue"
                : "Hủy ngừng phát triển"
              : locale === "en"
                ? "Discontinue"
                : "Ngừng phát triển"}
          </button>
        </div>
      </div>
    </div>
  );
}
