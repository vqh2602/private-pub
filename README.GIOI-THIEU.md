# Giới thiệu Private Pub Registry

## Tổng quan

Private Pub Registry là nền tảng quản lý và phân phối package Dart/Flutter riêng tư cho tổ chức. Dự án giúp đội ngũ phát triển lưu trữ thư viện nội bộ, kiểm soát người được phép đọc hoặc phát hành package, quản lý phiên bản và kiểm tra chất lượng mã nguồn trên hạ tầng do chính tổ chức vận hành.

Nền tảng tương thích với quy trình `dart pub` và `flutter pub`, đồng thời cung cấp giao diện Web, API, CLI và MCP server. Vì vậy, lập trình viên có thể tìm kiếm, cài đặt, kiểm tra và publish package bằng các công cụ quen thuộc mà không phải đưa mã nguồn nội bộ lên registry công cộng.

## Dự án giải quyết vấn đề gì?

Trong một tổ chức có nhiều dự án Dart hoặc Flutter, các thư viện dùng chung thường bị sao chép giữa repository, tham chiếu bằng Git hoặc phát hành thủ công. Cách làm này gây khó khăn khi cần quản lý phiên bản, phân quyền, truy vết thay đổi và chuẩn hóa chất lượng package.

Private Pub Registry cung cấp một điểm quản lý tập trung để:

- Lưu trữ và phân phối package Dart/Flutter nội bộ.
- Sử dụng package private qua chuẩn Hosted Pub Repository API V2.
- Quản lý tài khoản, token, publisher và quyền truy cập theo từng package.
- Tìm kiếm package, xem metadata, tài liệu và mã nguồn của từng phiên bản.
- Tự động phân tích chất lượng package sau khi phát hành.
- Publish package đơn hoặc cả monorepo bằng CLI mà không phải sửa `pubspec.yaml` trong source.
- Cho phép công cụ AI tra cứu chính xác package và source code nội bộ qua MCP.

## Đối tượng sử dụng

- Đội phát triển Dart/Flutter cần chia sẻ thư viện nội bộ.
- Doanh nghiệp không muốn đưa source code hoặc package độc quyền lên `pub.dev`.
- Platform team cần quản lý package, tài khoản, quyền hạn và lịch sử phát hành tập trung.
- Nhóm sử dụng monorepo có nhiều package phụ thuộc lẫn nhau.
- Nhóm muốn kết nối Cursor, Cline hoặc Claude Desktop với kho package nội bộ.

## Tính năng chính

### Registry Dart/Flutter riêng tư

- Cung cấp Hosted Pub Repository API V2 tương thích với Dart SDK.
- Publish, tải xuống và truy vấn các phiên bản package.
- Lưu archive `.tar.gz` bất biến trên local disk và lưu metadata trong PostgreSQL.
- Hỗ trợ package private, internal và public.
- Thu hồi hoặc khôi phục phiên bản; ngừng hoặc tiếp tục phát hành package.
- Import package và quản lý publisher.

### Giao diện quản trị và khám phá package

- Tìm kiếm và lọc package trên giao diện Web.
- Xem phiên bản, dependency, yêu cầu Dart/Flutter SDK, publisher và điểm chất lượng.
- Xem README, CHANGELOG, `pubspec.yaml`, cây file và source code theo từng phiên bản.
- So sánh nội dung giữa các phiên bản và tải archive.
- Quản lý tài khoản, vai trò, token và quyền package.
- Tra cứu các bản phát hành Flutter chính thức theo hệ điều hành, channel, Flutter SDK, Dart SDK hoặc commit.

### Xác thực và phân quyền

- Đăng nhập Web bằng session cookie HttpOnly.
- Personal Access Token (PAT) gắn với từng tài khoản và chỉ hiển thị plaintext một lần.
- OAuth Authorization Code với PKCE dành cho CLI.
- Vai trò `user`, `admin`, `super_admin` và quyền đọc/ghi/quản trị theo package.
- Bắt buộc đổi mật khẩu tạm ở lần đăng nhập đầu tiên.
- Băm mật khẩu, session và token; hỗ trợ rate limit, CSP, CORS và security headers.
- Ghi audit log cho các thao tác quản trị quan trọng.

### CLI dành cho lập trình viên

CLI `private_pub` hỗ trợ đầy đủ quy trình làm việc với registry:

- `login`: mở trình duyệt, đăng nhập OAuth PKCE và lưu credential cục bộ an toàn.
- `setup`: đăng ký lại token của registry vào Dart SDK.
- `publish`: tự chọn registry đã đăng nhập và publish mà không sửa file `pubspec.yaml` gốc.
- `prepare`: tạo bản package sẵn sàng publish từ monorepo.
- `publish --auto`: phân tích dependency graph, sắp xếp topo, chuyển path/workspace dependency thành hosted dependency và publish đúng thứ tự.
- `check`, `versions`, `compare`, `outdated`, `upgrade`: kiểm tra package và quản lý dependency private.
- `mcp`: chạy MCP server qua stdio cho các công cụ AI.

### Phân tích chất lượng bằng Worker

- Xử lý tác vụ nền thông qua hàng đợi Valkey.
- Hỗ trợ pipeline `pana`, `dart analyze`, `flutter analyze` và `dartdoc`.
- Lập chỉ mục metadata, dependency, tài liệu và source file để tìm kiếm hoặc duyệt code.
- Kiểm tra archive nhằm phát hiện path traversal, file trùng, file quá lớn và symlink không an toàn.
- Có chế độ mock analyzer cho môi trường phát triển không cài Dart/Flutter SDK.

### Tích hợp AI qua MCP

MCP server sử dụng cùng credential với CLI và cho phép công cụ AI:

- Tìm kiếm package nội bộ.
- Đọc metadata và danh sách phiên bản.
- Liệt kê file trong một phiên bản package.
- Đọc source code và tài liệu package.
- Đề xuất dependency hoặc API dựa trên đúng mã nguồn nội bộ của tổ chức.

## Kiến trúc hệ thống

```text
                  +----------------------+
                  |   Dart/Flutter CLI   |
                  | Web và AI/MCP client |
                  +----------+-----------+
                             |
                             v
                  +----------------------+
                  |     Fastify API      |
                  | Pub V2 + Control API |
                  +----+------------+----+
                       |            |
                       v            v
                +------------+  +----------------+
                | PostgreSQL |  | Local archives |
                | metadata   |  |    .tar.gz     |
                +------------+  +----------------+
                       |
                       v
                +------------+       +----------------+
                |   Valkey   | ----> | Analysis Worker|
                | job queue  |       | pana/analyzers |
                +------------+       +----------------+

                  +----------------------+
                  | Next.js Web frontend |
                  +----------------------+
```

Hệ thống được triển khai theo kiến trúc nhiều dịch vụ. Cấu hình Docker Compose mặc định gồm năm service:

| Service    | Vai trò                                                         |
| ---------- | --------------------------------------------------------------- |
| `web`      | Giao diện người dùng và quản trị                                |
| `api`      | Hosted Pub V2 API, control-plane API và OAuth                   |
| `worker`   | Phân tích package và xử lý tác vụ nền                           |
| `postgres` | Lưu tài khoản, package, phiên bản, quyền, metadata và audit log |
| `redis`    | Valkey dùng làm hạ tầng hàng đợi và điều phối tác vụ            |

Archive package được lưu trong Docker volume `archive-data`; dữ liệu PostgreSQL được lưu trong `postgres-data`. Kiến trúc hiện tại không sử dụng SQLite/Lite mode.

## Công nghệ sử dụng

| Nhóm             | Công nghệ                              | Mục đích                                           |
| ---------------- | -------------------------------------- | -------------------------------------------------- |
| Monorepo         | pnpm, Turborepo                        | Quản lý workspace, build và test đồng bộ           |
| Ngôn ngữ backend | TypeScript, Node.js 22+                | Xây dựng API, Worker và package dùng chung         |
| API              | Fastify 5, Zod, Swagger/OpenAPI        | HTTP API, validation và tài liệu API               |
| Web              | Next.js 15, React 19, Tailwind CSS     | Giao diện registry và trang quản trị               |
| Database         | PostgreSQL 17, Prisma ORM              | Dữ liệu nghiệp vụ, migration và truy vấn           |
| Queue/cache      | Valkey 8                               | Hàng đợi xử lý nền và điều phối Worker             |
| Package storage  | Local disk/Docker volume               | Lưu archive package `.tar.gz`                      |
| Quản lý SDK      | FVM 3.2.1, Flutter 3.41.9, Dart 3.11.5 | Ghim và đồng bộ SDK giữa local/Docker              |
| CLI              | Dart 3 qua FVM                         | Đăng nhập, cấu hình, publish và quản lý dependency |
| AI integration   | Model Context Protocol (MCP)           | Kết nối công cụ AI với registry nội bộ             |
| Kiểm thử         | Vitest, Dart test                      | Unit test và contract test                         |
| Đóng gói         | Docker, Docker Compose                 | Triển khai Web, API, Worker và hạ tầng             |

## Cấu trúc repository

```text
apps/
  api/                 Fastify API và OAuth server
  web/                 Ứng dụng Next.js
  worker/              Worker phân tích package
packages/
  contracts/           Schema Zod và kiểu dữ liệu dùng chung
  database/            Prisma schema, migration và seed
  private_pub_cli/      Dart CLI và MCP server
  ui/                   Thành phần giao diện dùng chung
  config/               Cấu hình TypeScript dùng chung
fixtures/               Package mẫu phục vụ kiểm thử
scripts/                Script hỗ trợ phát triển
```

## Quy trình sử dụng điển hình

1. Quản trị viên triển khai hệ thống và tạo tài khoản cho thành viên.
2. Lập trình viên đăng nhập Web để đổi mật khẩu tạm và kiểm tra quyền truy cập.
3. Lập trình viên chạy `private_pub login <registry-url>` để xác thực OAuth và cấu hình Dart SDK.
4. Package được publish bằng `private_pub publish` hoặc `private_pub publish --auto` đối với monorepo.
5. API lưu archive và metadata, sau đó gửi tác vụ phân tích qua Valkey cho Worker.
6. Worker phân tích package, lập chỉ mục và cập nhật điểm chất lượng.
7. Thành viên khác có thể thêm package vào dự án, tìm kiếm trên Web hoặc tra cứu qua AI/MCP.

## Triển khai nhanh

Yêu cầu Docker Desktop hoặc Docker Engine có Docker Compose:

```bash
cp .env.example .env
docker compose up --build -d
docker compose ps
```

Sau khi các service healthy:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- OpenAPI: `http://localhost:4000/docs`
- Health check: `http://localhost:4000/health`

Thông tin cài đặt chi tiết, cấu hình production, database, bảo mật và hướng dẫn CLI nằm trong [README.vi.md](README.vi.md) và [packages/private_pub_cli/README.md](packages/private_pub_cli/README.md).

## Giá trị mang lại

Private Pub Registry biến việc chia sẻ thư viện Dart/Flutter nội bộ thành một quy trình có quản trị: package có phiên bản rõ ràng, quyền truy cập được kiểm soát, thao tác được truy vết, chất lượng được phân tích và trải nghiệm publish được tự động hóa. Nền tảng phù hợp với đội ngũ muốn sở hữu hoàn toàn dữ liệu và hạ tầng package mà vẫn giữ trải nghiệm gần với `pub.dev` và công cụ Dart/Flutter tiêu chuẩn.
