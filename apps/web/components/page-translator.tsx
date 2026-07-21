"use client";

import { useEffect } from "react";
import type { Locale } from "@/components/language-provider";

// Existing pages are partly server-rendered. This keeps those pages reactive to the
// selected language while they are progressively moved to message keys.
const pairs: Array<[string, string]> = [
  ["Every package your team needs.", "Mọi package đội ngũ của bạn cần."],
  ["None you don’t trust.", "Không có package nào bạn không tin cậy."],
  [
    "Discover, inspect, and ship private Dart & Flutter packages from one secure registry.",
    "Khám phá, kiểm tra và phát hành package Dart & Flutter riêng tư từ một registry an toàn.",
  ],
  [
    "Search packages, publishers, or topics…",
    "Tìm package, nhà phát hành hoặc chủ đề…",
  ],
  ["Search registry", "Tìm trong registry"],
  ["Try:", "Thử:"],
  ["Private packages", "Package riêng tư"],
  ["Published versions", "Phiên bản đã phát hành"],
  ["Analyzed artifacts", "Tệp đã phân tích"],
  ["Registry catalogue", "Danh mục registry"],
  ["Packages your team relies on", "Các package đội ngũ của bạn sử dụng"],
  ["Sort by", "Sắp xếp theo"],
  ["Relevance", "Liên quan"],
  ["Recently updated", "Cập nhật gần đây"],
  ["Downloads", "Lượt tải"],
  ["Pub points", "Điểm pub"],
  ["Apply", "Áp dụng"],
  ["Filters", "Bộ lọc"],
  ["Clear", "Xóa bộ lọc"],
  ["Quality", "Chất lượng"],
  ["Has preview", "Có xem trước"],
  ["Verified publisher", "Nhà phát hành đã xác minh"],
  ["Apply filters", "Áp dụng bộ lọc"],
  ["No matching packages", "Không có package phù hợp"],
  [
    "Try a broader package name, topic, or publisher.",
    "Hãy thử tên package, chủ đề hoặc nhà phát hành rộng hơn.",
  ],
  ["Control plane", "Bảng điều khiển"],
  ["Registry administration", "Quản trị registry"],
  [
    "System health, queues, policy, and recent audit activity.",
    "Tình trạng hệ thống, hàng đợi, chính sách và hoạt động kiểm tra gần đây.",
  ],
  ["All systems operational", "Tất cả hệ thống hoạt động bình thường"],
  ["Packages currently in the registry", "Package hiện có trong registry"],
  ["All published package versions", "Tất cả phiên bản package đã phát hành"],
  ["Analyzed versions", "Phiên bản đã phân tích"],
  ["Infrastructure", "Hạ tầng"],
  ["Service health", "Tình trạng dịch vụ"],
  ["Object storage", "Lưu trữ đối tượng"],
  ["Analysis worker", "Worker phân tích"],
  ["Audit trail", "Nhật ký kiểm tra"],
  ["Recent activity", "Hoạt động gần đây"],
  ["Healthy", "Hoạt động tốt"],

  // Imports page
  ["Supply packages", "Cung cấp package"],
  ["Import from file", "Nhập từ tệp"],
  [
    "Upload a Dart/Flutter package archive to verify and import into the private registry.",
    "Upload một Dart/Flutter package archive để xác minh và đưa vào private registry.",
  ],
  ["Choose file", "Chọn file"],
  ["Verify", "Xác minh"],
  ["Result", "Kết quả"],
  ["Choose a package archive", "Chọn package archive"],
  [
    "Only .tar.gz files up to 100 MB are accepted",
    "Chỉ chấp nhận file .tar.gz, tối đa 100 MB",
  ],
  ["Verifying package", "Đang xác minh package"],
  ["Import failed", "Import thất bại"],
  ["Choose again", "Chọn lại"],
  ["Verify & import", "Xác minh & import"],
  [
    "Check archive structure and safe paths",
    "Kiểm tra cấu trúc archive và đường dẫn an toàn",
  ],
  ["Read and validate pubspec.yaml", "Đọc và xác minh pubspec.yaml"],
  [
    "Check package name, semantic version, and SDK constraint",
    "Kiểm tra tên package, semantic version và SDK constraint",
  ],
  ["Calculate SHA-256 and index files", "Tính SHA-256 và lập chỉ mục file"],
  [
    "The archive is saved only after every validation passes.",
    "Archive chỉ được lưu sau khi vượt qua toàn bộ bước kiểm tra.",
  ],
  ["New package created", "Đã tạo package mới"],
  ["New version added", "Đã thêm version mới"],

  // Flutter releases page
  ["Flutter release explorer", "Trình khám phá bản phát hành Flutter"],
  [
    "Search, review, and download official Flutter releases for each operating system.",
    "Tìm kiếm, thống kê và tải các bản Flutter chính thức cho từng hệ điều hành.",
  ],
  ["Releases", "Bản phát hành"],
  ["Stable releases", "Các bản stable"],
  ["Beta releases in the archive", "Các bản beta trong kho lưu trữ"],
  [
    "Search Flutter, Dart SDK, or commit…",
    "Tìm Flutter, Dart SDK hoặc commit…",
  ],
  ["Operating system", "Hệ điều hành"],
  ["Release channel", "Kênh phát hành"],
  ["All channels", "Tất cả kênh"],
  ["Search", "Tìm kiếm"],
  ["Official Flutter archive", "Kho Flutter chính thức"],
  ["Release date", "Ngày phát hành"],
  ["Architecture", "Kiến trúc"],
  ["Current", "Hiện tại"],
  ["No releases found", "Không tìm thấy phiên bản"],
  [
    "Try another keyword or remove the release-channel filter.",
    "Thử từ khóa khác hoặc bỏ bộ lọc kênh phát hành.",
  ],
  ["← Previous page", "← Trang trước"],
  ["Next page →", "Trang sau →"],
  [
    "Unable to load the Flutter SDK list",
    "Không thể tải danh sách Flutter SDK",
  ],
  [
    "The Flutter data source is temporarily unavailable.",
    "Nguồn dữ liệu Flutter tạm thời không khả dụng.",
  ],
  ["Archive for Windows", "Kho lưu trữ dành cho Windows"],
  ["Archive for macOS", "Kho lưu trữ dành cho macOS"],
  ["Archive for Linux", "Kho lưu trữ dành cho Linux"],
  ["Channel", "Kênh"],

  // User management and general admin
  ["Access control", "Kiểm soát truy cập"],
  ["Users", "Người dùng"],
  ["Create user", "Tạo người dùng"],
  ["Close", "Đóng"],
  ["Temporary password", "Mật khẩu tạm thời"],
  ["Role", "Vai trò"],
  ["Create account", "Tạo tài khoản"],
  ["Creating…", "Đang tạo…"],
  ["Password change pending", "Chờ đổi mật khẩu"],
  ["Active", "Đang hoạt động"],
  ["Locked", "Đã khóa"],
  ["No accounts yet.", "Chưa có tài khoản nào."],

  // Account settings
  ["Account", "Tài khoản"],
  ["Security", "Bảo mật"],
  ["Change password", "Đổi mật khẩu"],
  ["Current password", "Mật khẩu hiện tại"],
  [
    "New password (at least 10 characters)",
    "Mật khẩu mới (tối thiểu 10 ký tự)",
  ],
  ["Confirm new password", "Xác nhận mật khẩu mới"],
  ["Sign out", "Đăng xuất"],
  ["Manage tokens", "Quản lý token"],
  ["Developer access", "Truy cập nhà phát triển"],
  [
    "You are using a temporary password. Please change your password before performing administrative tasks or creating tokens.",
    "Bạn đang dùng mật khẩu tạm thời. Hãy đổi mật khẩu trước khi thực hiện thao tác quản trị hoặc tạo token.",
  ],
  [
    "Your current session will end after successfully changing the password.",
    "Phiên đăng nhập hiện tại sẽ kết thúc sau khi đổi thành công.",
  ],
  [
    "Create and revoke tokens for use with dart pub, CI, or package publishing workflows.",
    "Tạo và thu hồi token dùng với dart pub, CI hoặc quy trình phát hành package.",
  ],

  ["Signed-in account", "Tài khoản đang đăng nhập"],
  ["Your packages and versions", "Gói và phiên bản của bạn"],
  ["Loading published releases…", "Đang tải các bản publish…"],
  ["Sign in to view your packages", "Đăng nhập để xem các gói của bạn"],
  [
    "This list only shows versions published by the current account.",
    "Danh sách này chỉ hiển thị các version do chính tài khoản hiện tại publish.",
  ],
  ["Go to sign in →", "Đi đến đăng nhập →"],
  ["No published releases yet", "Chưa có bản publish nào"],
  [
    "Packages and versions published with this account's token will appear here.",
    "Sau khi publish bằng token của tài khoản này, package và version sẽ xuất hiện tại đây.",
  ],
  ["Revoked", "Đã thu hồi"],

  ["Personal access tokens", "Personal access tokens"],
  ["Create token", "Create token"],
  ["Cancel", "Cancel"],
  ["Bắt buộc bảo mật", "Security required"],
  ["Đổi mật khẩu mặc định", "Change default password"],
  ["Token name", "Token name"],
  ["Expires in days", "Expires in days"],
  ["Không hết hạn", "Never expires"],
  ["Create secure token", "Create secure token"],
  ["Previously created tokens", "Previously created tokens"],
  ["CLI quick start", "CLI quick start"],
  ["Connect dart pub", "Connect dart pub"],
  ["Package not found", "Không tìm thấy package"],
  [
    "The package may be private, renamed, or unavailable.",
    "Package có thể là riêng tư, đã đổi tên hoặc không khả dụng.",
  ],
  ["Back to registry", "Quay lại registry"],
  ["Install", "Cài đặt"],
  ["Add to pubspec.yaml", "Thêm vào pubspec.yaml"],
  ["Requirements", "Yêu cầu"],
  ["Package metadata", "Thông tin package"],
  ["Dependencies", "Phụ thuộc"],
  ["Versions", "Phiên bản"],
  ["Published by", "Phát hành bởi"],
  ["Updated 1 day ago", "Cập nhật 1 ngày trước"],
  ["Documentation", "Tài liệu"],
  ["Browse files", "Xem tệp"],
  ["Files", "Tệp"],
  ["Metadata", "Siêu dữ liệu"],
  ["Ready", "Sẵn sàng"],
];

function normalizeSpace(str: string): string {
  return str.replace(/\s+/g, " ").trim();
}

function localized(value: string, locale: Locale) {
  const normValue = normalizeSpace(value);

  const matchingVersions = normValue.match(/^(\d+) phiên bản phù hợp$/);
  if (matchingVersions)
    return locale === "en" ? `${matchingVersions[1]} matching releases` : value;
  const matchingVersionsEn = normValue.match(/^(\d+) matching releases$/);
  if (matchingVersionsEn)
    return locale === "vi"
      ? `${matchingVersionsEn[1]} phiên bản phù hợp`
      : value;

  const page = normValue.match(/^Trang (\d+) \/ (\d+)$/);
  if (page) return locale === "en" ? `Page ${page[1]} / ${page[2]}` : value;
  const pageEn = normValue.match(/^Page (\d+) \/ (\d+)$/);
  if (pageEn)
    return locale === "vi" ? `Trang ${pageEn[1]} / ${pageEn[2]}` : value;

  const latestFlutter = normValue.match(/^Mới nhất: Flutter (.+)$/);
  if (latestFlutter)
    return locale === "en" ? `Latest: Flutter ${latestFlutter[1]}` : value;
  const latestFlutterEn = normValue.match(/^Latest: Flutter (.+)$/);
  if (latestFlutterEn)
    return locale === "vi" ? `Mới nhất: Flutter ${latestFlutterEn[1]}` : value;

  const downloadFlutter = normValue.match(/^Tải Flutter (.+)$/);
  if (downloadFlutter)
    return locale === "en" ? `Download Flutter ${downloadFlutter[1]}` : value;
  const downloadFlutterEn = normValue.match(/^Download Flutter (.+)$/);
  if (downloadFlutterEn)
    return locale === "vi" ? `Tải Flutter ${downloadFlutterEn[1]}` : value;

  const pair = pairs.find(
    ([en, vi]) =>
      normalizeSpace(en) === normValue || normalizeSpace(vi) === normValue,
  );
  return pair ? pair[locale === "en" ? 0 : 1] : value;
}

function translateTextNode(node: Text, locale: Locale) {
  const parent = node.parentElement;
  if (!parent || parent.closest("code, pre, script, style")) return;
  const text = node.nodeValue ?? "";
  const spaces = text.match(/^(\s*)/)?.[0] ?? "";
  const value = text.trim();
  const translated = localized(value, locale);
  if (value && translated !== value) {
    node.nodeValue = `${spaces}${translated}${text.slice(spaces.length + value.length)}`;
  }
}

function translateAttributes(element: HTMLElement, locale: Locale) {
  for (const attribute of ["placeholder", "title", "aria-label"]) {
    const value = element.getAttribute(attribute);
    if (value) {
      element.setAttribute(attribute, localized(value, locale));
    }
  }
}

function translateDOM(root: HTMLElement | Node, locale: Locale) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, locale);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  const element = root as HTMLElement;

  // Translate text nodes inside
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    translateTextNode(node, locale);
  }

  // Translate attributes of self
  translateAttributes(element, locale);

  // Translate attributes of children
  const elements = element.querySelectorAll<HTMLElement>(
    "[placeholder], [title], [aria-label]",
  );
  for (const el of elements) {
    translateAttributes(el, locale);
  }
}

export function PageTranslator({ locale }: { locale: Locale }) {
  useEffect(() => {
    // Initial translation of the entire document body
    translateDOM(document.body, locale);

    // Set up MutationObserver to translate dynamically rendered elements
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            translateDOM(node, locale);
          });
        } else if (mutation.type === "characterData") {
          if (mutation.target.nodeType === Node.TEXT_NODE) {
            translateTextNode(mutation.target as Text, locale);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [locale]);

  return null;
}
