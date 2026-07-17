"use client";

import { useEffect } from "react";
import type { Locale } from "@/components/language-provider";

// Existing pages are partly server-rendered.  This keeps those pages reactive to the
// selected language while they are progressively moved to message keys.
const pairs: Array<[string, string]> = [
  ["Every package your team needs.", "Mọi package đội ngũ của bạn cần."], ["None you don’t trust.", "Không có package nào bạn không tin cậy."],
  ["Discover, inspect, and ship private Dart & Flutter packages from one secure registry.", "Khám phá, kiểm tra và phát hành package Dart & Flutter riêng tư từ một registry an toàn."],
  ["Search packages, publishers, or topics…", "Tìm package, nhà phát hành hoặc chủ đề…"], ["Search registry", "Tìm trong registry"], ["Try:", "Thử:"],
  ["Private packages", "Package riêng tư"], ["Published versions", "Phiên bản đã phát hành"], ["Analyzed artifacts", "Tệp đã phân tích"],
  ["Registry catalogue", "Danh mục registry"], ["Packages your team relies on", "Các package đội ngũ của bạn sử dụng"], ["Sort by", "Sắp xếp theo"],
  ["Relevance", "Liên quan"], ["Recently updated", "Cập nhật gần đây"], ["Downloads", "Lượt tải"], ["Pub points", "Điểm pub"], ["Apply", "Áp dụng"],
  ["Filters", "Bộ lọc"], ["Clear", "Xóa bộ lọc"], ["Quality", "Chất lượng"], ["Has preview", "Có xem trước"], ["Verified publisher", "Nhà phát hành đã xác minh"], ["Apply filters", "Áp dụng bộ lọc"], ["No matching packages", "Không có package phù hợp"], ["Try a broader package name, topic, or publisher.", "Hãy thử tên package, chủ đề hoặc nhà phát hành rộng hơn."],
  ["Control plane", "Bảng điều khiển"], ["Registry administration", "Quản trị registry"], ["System health, queues, policy, and recent audit activity.", "Tình trạng hệ thống, hàng đợi, chính sách và hoạt động kiểm tra gần đây."], ["All systems operational", "Tất cả hệ thống hoạt động bình thường"],
  ["Packages currently in the registry", "Package hiện có trong registry"], ["All published package versions", "Tất cả phiên bản package đã phát hành"], ["Analyzed versions", "Phiên bản đã phân tích"], ["Infrastructure", "Hạ tầng"], ["Service health", "Tình trạng dịch vụ"], ["Object storage", "Lưu trữ đối tượng"], ["Analysis worker", "Worker phân tích"], ["Audit trail", "Nhật ký kiểm tra"], ["Recent activity", "Hoạt động gần đây"], ["Healthy", "Hoạt động tốt"],
  ["Supply packages", "Cung cấp package"], ["Import from file", "Nhập từ tệp"], ["Upload một Dart/Flutter package archive để xác minh và đưa vào private registry.", "Tải lên gói Dart/Flutter để xác minh và đưa vào registry riêng tư."], ["Chọn file", "Choose file"], ["Xác minh", "Verify"], ["Kết quả", "Result"], ["Chọn package archive", "Choose a package archive"], ["Chỉ chấp nhận file .tar.gz, tối đa 100 MB", "Only .tar.gz files up to 100 MB are accepted"], ["Đang xác minh package", "Verifying package"], ["Import thất bại", "Import failed"], ["Chọn lại", "Choose again"], ["Xác minh & import", "Verify & import"],
  ["Kiểm tra cấu trúc archive và đường dẫn an toàn", "Check archive structure and safe paths"], ["Đọc và xác minh pubspec.yaml", "Read and validate pubspec.yaml"], ["Kiểm tra tên package, semantic version và SDK constraint", "Check package name, semantic version, and SDK constraint"], ["Tính SHA-256 và lập chỉ mục file", "Calculate SHA-256 and index files"], ["Archive chỉ được lưu sau khi vượt qua toàn bộ bước kiểm tra.", "The archive is saved only after every validation passes."], ["Đã tạo package mới", "New package created"], ["Đã thêm version mới", "New version added"],
  ["Flutter release explorer", "Trình khám phá bản phát hành Flutter"], ["Tìm kiếm, thống kê và tải các bản Flutter chính thức cho từng hệ điều hành.", "Search, review, and download official Flutter releases for each operating system."], ["Bản phát hành", "Releases"], ["Các bản stable", "Stable releases"], ["Các bản beta trong kho lưu trữ", "Beta releases in the archive"], ["Tìm Flutter, Dart SDK hoặc commit…", "Search Flutter, Dart SDK, or commit…"], ["Hệ điều hành", "Operating system"], ["Kênh phát hành", "Release channel"], ["Tất cả kênh", "All channels"], ["Tìm kiếm", "Search"], ["Kho Flutter chính thức", "Official Flutter archive"], ["Ngày phát hành", "Release date"], ["Kiến trúc", "Architecture"], ["Hiện tại", "Current"], ["Không tìm thấy phiên bản", "No releases found"], ["Thử từ khóa khác hoặc bỏ bộ lọc kênh phát hành.", "Try another keyword or remove the release-channel filter."], ["← Trang trước", "← Previous page"], ["Trang sau →", "Next page →"], ["Không thể tải danh sách Flutter SDK", "Unable to load the Flutter SDK list"], ["Nguồn dữ liệu Flutter tạm thời không khả dụng.", "The Flutter data source is temporarily unavailable."],
  ["Access control", "Kiểm soát truy cập"], ["Users", "Người dùng"], ["Create user", "Tạo người dùng"], ["Close", "Đóng"], ["Temporary password", "Mật khẩu tạm thời"], ["Role", "Vai trò"], ["Create account", "Tạo tài khoản"], ["Creating…", "Đang tạo…"], ["Password change pending", "Chờ đổi mật khẩu"], ["Active", "Đang hoạt động"], ["Locked", "Đã khóa"], ["No accounts yet.", "Chưa có tài khoản nào."],
  ["Signed-in account", "Tài khoản đang đăng nhập"], ["Your packages and versions", "Gói và phiên bản của bạn"], ["Loading published releases…", "Đang tải các bản publish…"], ["Sign in to view your packages", "Đăng nhập để xem các gói của bạn"], ["This list only shows versions published by the current account.", "Danh sách này chỉ hiển thị các version do chính tài khoản hiện tại publish."], ["Go to sign in →", "Đi đến đăng nhập →"], ["No published releases yet", "Chưa có bản publish nào"], ["Packages and versions published with this account's token will appear here.", "Sau khi publish bằng token của tài khoản này, package và version sẽ xuất hiện tại đây."], ["Revoked", "Đã thu hồi"],
  ["Tài khoản", "Account"], ["Bảo mật", "Security"], ["Đổi mật khẩu", "Change password"], ["Mật khẩu hiện tại", "Current password"], ["Mật khẩu mới (tối thiểu 10 ký tự)", "New password (at least 10 characters)"], ["Xác nhận mật khẩu mới", "Confirm new password"], ["Đăng xuất", "Sign out"], ["Quản lý token", "Manage tokens"],
  ["Personal access tokens", "Personal access tokens"], ["Create token", "Create token"], ["Cancel", "Cancel"], ["Bắt buộc bảo mật", "Security required"], ["Đổi mật khẩu mặc định", "Change default password"], ["Token name", "Token name"], ["Expires in days", "Expires in days"], ["Không hết hạn", "Never expires"], ["Create secure token", "Create secure token"], ["Previously created tokens", "Previously created tokens"], ["CLI quick start", "CLI quick start"], ["Connect dart pub", "Connect dart pub"],
  ["Package not found", "Không tìm thấy package"], ["The package may be private, renamed, or unavailable.", "Package có thể là riêng tư, đã đổi tên hoặc không khả dụng."], ["Back to registry", "Quay lại registry"],
  ["Install", "Cài đặt"], ["Add to pubspec.yaml", "Thêm vào pubspec.yaml"], ["Requirements", "Yêu cầu"], ["Package metadata", "Thông tin package"], ["Dependencies", "Phụ thuộc"], ["Versions", "Phiên bản"], ["Published by", "Phát hành bởi"], ["Updated 1 day ago", "Cập nhật 1 ngày trước"], ["Documentation", "Tài liệu"], ["Browse files", "Xem tệp"], ["Files", "Tệp"], ["Metadata", "Siêu dữ liệu"], ["Ready", "Sẵn sàng"],
];

function localized(value: string, locale: Locale) {
  const matchingVersions = value.match(/^(\d+) phiên bản phù hợp$/);
  if (matchingVersions) return locale === "en" ? `${matchingVersions[1]} matching releases` : value;
  const page = value.match(/^Trang (\d+) \/ (\d+)$/);
  if (page) return locale === "en" ? `Page ${page[1]} / ${page[2]}` : value;
  const pair = pairs.find(([en, vi]) => value === en || value === vi);
  return pair ? pair[locale === "en" ? 0 : 1] : value;
}

export function PageTranslator({ locale }: { locale: Locale }) {
  useEffect(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const parent = node.parentElement;
      if (!parent || parent.closest("code, pre, script, style")) continue;
      const text = node.nodeValue ?? "";
      const spaces = text.match(/^(\s*)/)?.[0] ?? "";
      const value = text.trim();
      const translated = localized(value, locale);
      if (value && translated !== value) node.nodeValue = `${spaces}${translated}${text.slice(spaces.length + value.length)}`;
    }
    for (const element of document.querySelectorAll<HTMLElement>("[placeholder], [title], [aria-label]")) {
      for (const attribute of ["placeholder", "title", "aria-label"]) {
        const value = element.getAttribute(attribute);
        if (value) element.setAttribute(attribute, localized(value, locale));
      }
    }
  }, [locale]);
  return null;
}
