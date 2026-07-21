# Constellation — registry Dart/Flutter riêng tư

Constellation là khung monorepo hướng đến môi trường production cho một registry package Dart và Flutter riêng tư. Dự án cung cấp bề mặt Hosted Pub Repository API V2 cho `dart pub` và một control-plane API riêng cho ứng dụng web, quản trị, nhập package, duyệt mã nguồn, phân tích và chấm điểm.

Repository có thể chạy ở chế độ demo với dữ liệu xác định. PostgreSQL, Valkey, OIDC, hàng đợi bền vững, lưu trữ tương thích S3 và các analyzer Dart/Flutter thực được biểu diễn bằng adapter cùng ranh giới schema rõ ràng; các tích hợp production chưa được trình bày như hoàn chỉnh ở những nơi cần credential hoặc hạ tầng tách biệt.

## Những gì đã được triển khai

- Giao diện Next.js hiện đại với tìm kiếm package, bộ lọc, chi tiết package, yêu cầu Dart/Flutter tối thiểu, ràng buộc dependency, phiên bản, phân tích điểm số, publisher, trình hướng dẫn nhập package, quản lý token và quản trị.
- Trình khám phá tệp lịch sử với cây tệp, xem trước Markdown, xem trước pubspec có cấu trúc, trình xem mã nguồn, chế độ xem raw, so sánh phiên bản đơn giản và phương án dự phòng phù hợp cho tệp nhị phân.
- Fastify API với hai bề mặt riêng `/api/packages/...` và `/v1/...`.
- Metadata package/phiên bản Hosted Pub V2, phân giải URL archive, quy trình thương lượng upload, endpoint adapter upload và endpoint hoàn tất.
- Route control-plane cho tìm kiếm, package, tệp, điểm số, nhập package, phân tích, PAT, thu hồi/khôi phục và ngừng/tiếp tục phát hành.
- Tài khoản lưu trong database, phiên đăng nhập HttpOnly, PAT thuộc tài khoản, phản hồi plaintext PAT một lần, băm secret với pepper phía server, giới hạn tốc độ, CSP và security header.
- Quản trị viên tạo người dùng, bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên và trang tài khoản tự phục vụ để đổi mật khẩu bất kỳ lúc nào.
- Trình khám phá bản phát hành Flutter dùng archive release chính thức của Flutter cho Windows, macOS và Linux, với tìm kiếm theo phiên bản, channel, Dart SDK và commit.
- Bộ kiểm tra chỉ mục archive phát hiện đường dẫn traversal, đường dẫn trùng lặp, tệp quá lớn và target symlink không an toàn.
- Pipeline worker có thể cấu hình với các bước lệnh `pana`, `dart analyze`, `flutter analyze` và `dartdoc`, kèm chế độ mock không cần SDK.
- Prisma schema bao phủ package, phiên bản, tệp, dependency, phân tích, điểm số, publisher, quyền, token, nhập package, tài liệu tìm kiếm và audit log.
- Kiểm thử unit/contract và fixture package an toàn/lỗi định dạng.
- CLI đầy đủ cho OAuth PKCE, tự cấu hình Dart token, smart publish không sửa
  `pubspec.yaml`, chuẩn bị/publish monorepo theo thứ tự topo và MCP stdio cho AI.

## Sơ đồ repository

```text
apps/
  api/       API registry và control-plane Fastify
  web/       Ứng dụng Next.js
  worker/    Pipeline worker phân tích và lập chỉ mục
packages/
  contracts/ Schema Zod và kiểu TypeScript dùng chung
  database/  Prisma schema, phần mở rộng migration và seed
  private_pub_cli/ Dart CLI kiểm tra, so sánh và nâng cấp dependency private
  ui/        Các UI primitive dùng chung
  config/    Cấu hình TypeScript dùng chung
fixtures/    Fixture package hợp lệ và lỗi định dạng
scripts/     Tiện ích tạo fixture
```

## Chạy cục bộ

Yêu cầu: Node.js 22+, pnpm 10+ và tùy chọn Docker Desktop.

```bash
cp .env.example .env
pnpm install
pnpm fixtures:create
pnpm dev
```

Mở:

- Ứng dụng web: `http://localhost:3000`
- API: `http://localhost:4000`
- Giao diện OpenAPI: `http://localhost:4000/docs`
- Kiểm tra health: `http://localhost:4000/health`

Chế độ database là mặc định an toàn. Chỉ đặt tường minh `DEMO_MODE=true` khi cần dữ liệu demo; khi đó API không yêu cầu token hoặc chấp nhận `Bearer demo-admin-token` và cấp mọi demo scope. Production sẽ từ chối khởi động nếu demo mode được bật hoặc cấu hình này bị bỏ trống.

Để chạy hạ tầng và ứng dụng trong container:

```bash
cp .env.example .env
docker compose up --build -d
docker compose ps
```

### Cấu hình production

Tạo file môi trường production từ mẫu, thay toàn bộ giá trị `CHANGE_ME`, rồi
khởi động Compose với chính file đó:

```bash
cp .env.production.example .env.production
# Chỉnh domain HTTPS, mật khẩu PostgreSQL, TOKEN_PEPPER và admin password.
docker compose --env-file .env.production up --build -d
```

Mẫu [`.env.production.example`](.env.production.example) đặt `DEMO_MODE=false`,
cookie HTTPS, CORS allowlist và các secret bắt buộc cho production. Không commit
`.env.production`; file này đã được ignore bởi Git.

Docker image build API, Web và Worker trước khi chạy; source code không được bind-mount vào container. Migration PostgreSQL đã commit được áp dụng tự động khi API khởi động. PostgreSQL và Valkey chỉ bind vào loopback ở cổng `5432` và `6379`.

Archive được lưu dưới dạng `.tar.gz` trong named volume `archive-data` tại `/data/archives`; PostgreSQL dùng volume `postgres-data`. `docker compose down` giữ nguyên cả hai volume, còn `docker compose down --volumes` sẽ xóa toàn bộ dữ liệu local này.

## Database

Schema database chỉ hỗ trợ PostgreSQL và được định nghĩa tại [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma). Schema gồm các bảng tài khoản, phiên, token thuộc tài khoản, package, phiên bản, metadata archive, chỉ mục tệp, dependency, publisher, quyền, import, phân tích, điểm số, tìm kiếm và audit.

### Khởi tạo PostgreSQL cục bộ

Yêu cầu: Docker Desktop (hoặc PostgreSQL 17+ cài cục bộ), Node.js 22+ và pnpm 10+.

1. Tạo tệp môi trường cục bộ và chỉ khởi động PostgreSQL:

```bash
cp .env.example .env
docker compose up -d postgres
docker compose ps postgres
```

Chờ đến khi dịch vụ có trạng thái `healthy`. Chuỗi kết nối cục bộ mặc định là:

```text
postgresql://private_pub:private_pub@localhost:5432/private_pub?schema=public
```

2. Export chuỗi kết nối để chạy lệnh Prisma. Việc này được làm tường minh để lệnh hoạt động bất kể Prisma nạp `.env` từ thư mục nào:

```bash
export DATABASE_URL='postgresql://private_pub:private_pub@localhost:5432/private_pub?schema=public'
```

3. Sinh Prisma Client và tạo table migration trong lần thiết lập cục bộ đầu tiên:

```bash
pnpm db:generate
pnpm --filter @private-pub/database exec prisma migrate dev --name create_registry_tables
```

Migration `202607170001_init` đã commit sẽ bật extension PostgreSQL `pg_trgm`. Lệnh phía trên tạo và áp dụng migration tiếp theo, chứa các bảng khai báo trong `schema.prisma`. Hãy commit migration mới đó khi muốn chia sẻ với nhóm.

4. Tùy chọn chèn publisher và package mẫu:

```bash
pnpm db:seed
```

5. Kiểm tra kết quả:

```bash
pnpm --filter @private-pub/database exec prisma migrate status
docker compose exec postgres psql -U private_pub -d private_pub -c '\dt'
pnpm --filter @private-pub/database exec prisma studio
```

Prisma Studio mở trình duyệt database cục bộ; nhấn `Ctrl+C` để dừng khi hoàn tất.

### Lệnh phát triển thường dùng

Sau khi thiết lập lần đầu, dùng các lệnh này khi Prisma schema thay đổi:

```bash
export DATABASE_URL='postgresql://private_pub:private_pub@localhost:5432/private_pub?schema=public'
pnpm --filter @private-pub/database exec prisma migrate dev --name describe_the_change
pnpm db:generate
pnpm db:seed
```

Dùng tên migration dạng `snake_case` có ý nghĩa, ví dụ `add_package_visibility`. Không chỉnh sửa migration đã được áp dụng; hãy thêm migration mới.

### Áp dụng migration trong môi trường đã triển khai

CI hoặc production chỉ được áp dụng migration đã commit vào Git. Không được chạy `prisma migrate dev`:

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public'
pnpm --filter @private-pub/database exec prisma migrate deploy
pnpm --filter @private-pub/database exec prisma migrate status
```

Dùng secret manager hoặc biến môi trường triển khai cho URL production. Không bao giờ commit credential production vào `.env`.

### Đặt lại database cục bộ

Chỉ dùng cho dữ liệu cục bộ có thể bỏ đi; thao tác này xóa toàn bộ bảng và bản ghi khỏi `private_pub`:

```bash
export DATABASE_URL='postgresql://private_pub:private_pub@localhost:5432/private_pub?schema=public'
pnpm --filter @private-pub/database exec prisma migrate reset
```

Để xóa hoàn toàn volume PostgreSQL của Docker, hãy dừng stack và xóa named volume. Thao tác này cũng xóa vĩnh viễn dữ liệu database cục bộ:

```bash
docker compose down --volumes
```

### Chế độ lưu trữ hiện tại của ứng dụng

Đặt `DEMO_MODE=false` để API sử dụng `PrismaRegistryRepository`. Metadata package, phiên bản, dependency, chỉ mục tệp, điểm số, import, API token, trạng thái thu hồi và trạng thái ngừng phát hành khi đó được đọc từ và ghi vào PostgreSQL.

Ở database mode, nội dung các file source trong trình duyệt file không nằm trong RAM hay các file preview rời; PostgreSQL chỉ giữ metadata/chỉ mục cùng README/CHANGELOG phục vụ tìm kiếm và trang chi tiết. Mỗi version tham chiếu đến một archive `.tar.gz` bất biến trong `ARCHIVE_STORAGE_DIR`; endpoint download stream trực tiếp từ disk. Khi người dùng mở một file, API chỉ giải nén entry được yêu cầu với giới hạn `MAX_TEXT_PREVIEW_BYTES` (mặc định 512.000 byte). RAM chỉ giữ metadata và buffer ngắn hạn của đúng entry đang được xem.

Đặt `PUBLISHER_ID=platform.internal` để publisher của package publish mới là `platform.internal`. Biến này cho phép thay publisher theo môi trường mà không cần sửa mã nguồn.

API và Web đều nạp `.env` ở thư mục gốc monorepo trong quá trình phát triển cục bộ. Sau khi thay `DEMO_MODE`, khởi động lại cả hai tiến trình và xác minh repository đang hoạt động:

```bash
curl http://localhost:4000/health
```

Phản hồi phải chứa `"mode":"database"`. Ở database mode, ứng dụng Web không dùng fallback demo tích hợp, vì vậy API không khả dụng sẽ hiện lỗi thay vì hiển thị package mẫu cục bộ.

### Tài khoản quản trị và token

Khi chạy local ở database mode và bảng `accounts` chưa có dữ liệu, API tự tạo tài khoản quyền cao nhất với thông tin mặc định:

```text
username: admin
password: admin
```

Production không chấp nhận credential mặc định. Lần khởi động đầu tiên bắt buộc đặt `DEFAULT_ADMIN_USERNAME` và `DEFAULT_ADMIN_PASSWORD` dài ít nhất 16 ký tự; đồng thời phải cấu hình `TOKEN_PEPPER`, `COOKIE_SECURE=true`, HTTPS `PUBLIC_BASE_URL` và allowlist `CORS_ORIGINS`.

Mở `http://localhost:3000/login`, đăng nhập và đổi mật khẩu ngay. Tài khoản mặc định có cờ `must_change_password`, vì vậy API từ chối tạo/quản lý token và các thao tác ghi cho tới khi mật khẩu được đổi. Có thể thay thông tin bootstrap lần đầu bằng `DEFAULT_ADMIN_USERNAME` và `DEFAULT_ADMIN_PASSWORD`; các biến này không ghi đè tài khoản đã tồn tại.

Quản trị viên tạo tài khoản mới tại `http://localhost:3000/admin`. Mật khẩu nhập ở đây là mật khẩu tạm thời; tài khoản mới luôn được gắn cờ bắt buộc đổi mật khẩu. Người dùng có thể đổi mật khẩu bất kỳ lúc nào tại `http://localhost:3000/account`. Chỉ `super_admin` được tạo thêm tài khoản `admin` hoặc `super_admin`; tài khoản `admin` thông thường chỉ được tạo vai trò `user`.

Trang `http://localhost:3000/flutter` cung cấp trình tra cứu release Flutter theo tinh thần Sidekick. Dữ liệu được đọc từ kho release chính thức của Flutter và cache một giờ ở phía Next.js; có thể lọc theo Windows/macOS/Linux, stable/beta/dev, phiên bản Flutter, Dart SDK hoặc commit hash.

Session đăng nhập được lưu ở cookie HttpOnly, `SameSite=Lax`, có thời hạn theo `SESSION_TTL_HOURS`. Đặt `COOKIE_SECURE=true` khi cả Web và API được phục vụ qua HTTPS. PAT được gắn với `account_id`; trang Tokens chỉ liệt kê và cho thu hồi token thuộc tài khoản hiện tại. Mật khẩu, session và PAT không được lưu dạng rõ trong PostgreSQL.

Package mới mặc định là private và tài khoản phát hành đầu tiên nhận quyền `PACKAGE_ADMIN`. Chỉ package admin/writer hoặc quản trị viên registry được thêm version. Metadata, source preview và archive private trả về `404` cho request không có quyền; package `INTERNAL` dành cho mọi tài khoản đã đăng nhập và `PUBLIC` có thể đọc ẩn danh.

Analyzer thật chỉ được bật trong production khi job chạy trong sandbox tách biệt và `ANALYZER_SANDBOXED=true`. Runner phải không chứa credential, chạy user không đặc quyền, giới hạn CPU/RAM/process, dùng filesystem tạm và chặn network mặc định. Nếu chưa có runner này, giữ `MOCK_ANALYZER=true`.

FVM là tùy chọn (optional). Theo mặc định, Worker và CLI sẽ gọi trực tiếp lệnh `dart` hoặc `flutter` từ hệ thống (`PATH`). Nếu muốn dùng FVM, bạn có thể thiết lập `USE_FVM=true` hoặc đặt biến môi trường `FVM_EXECUTABLE` trỏ tới đường dẫn binary FVM của bạn. Repository ghim Flutter trong `.fvmrc` (bộ công cụ đang ghim là FVM `3.2.1`, Flutter `3.41.9` và Dart `3.11.5`).

Đổi `FLUTTER_VERSION` trong `.env` để chọn SDK của Docker image, sau đó build lại bằng `docker compose build --no-cache`. Với local khi sử dụng FVM, chạy `fvm use <version>` tại thư mục repository để cập nhật `.fvmrc`. Phiên bản đang chạy thực tế luôn được phát hiện từ toolchain đang chạy và hiển thị ở footer Web.

## Quy trình Dart CLI

Repository có package CLI độc lập tại `packages/private_pub_cli`. Có thể chạy trực tiếp trong source bằng `dart run` (hoặc `fvm dart run`), hoặc activate toàn cục để dùng lệnh `ppub`:

```bash
cd packages/private_pub_cli
# Nếu dùng SDK hệ thống:
dart pub global activate --source path .

# Nếu dùng FVM:
fvm dart pub global activate --source path .

ppub --host http://localhost:4000 check
ppub --host http://localhost:4000 versions aurora_ui
ppub --host http://localhost:4000 compare aurora_ui 1.0.0 2.0.0
ppub --host http://localhost:4000 outdated
ppub --host http://localhost:4000 upgrade
ppub --host http://localhost:4000 upgrade --major-versions --dry-run
```

CLI tự chọn `flutter pub` cho Flutter project và `dart pub` cho Dart project (hoặc chạy qua FVM nếu FVM được bật).
Xem hướng dẫn đầy đủ trong `packages/private_pub_cli/README.md`.

Đăng nhập OAuth trực tiếp từ terminal. CLI mở browser, dùng Authorization Code
với PKCE, lưu token quyền tối thiểu trong file cấu hình mode `0600`, rồi đăng ký
token với Dart SDK:

```bash
ppub login http://localhost:4000

# Đăng ký lại sau khi cài Dart SDK mới:
ppub setup
```

Smart publish tự chọn registry đã đăng nhập và tạo một package copy tạm có
`publish_to`; `pubspec.yaml` trong checkout không bị thay đổi:

```bash
ppub -C path/to/package publish
ppub -C path/to/package publish --dry-run

# Monorepo: đổi path/workspace dependency thành hosted reference và publish
# dependency trước dependent.
ppub -C path/to/monorepo publish --auto
ppub -C path/to/monorepo publish --auto app_package shared_package
ppub -C path/to/monorepo prepare --output /tmp/publish-ready
```

MCP server dùng cùng credential và cung cấp tool tìm package, đọc metadata,
liệt kê file và đọc source file cho Cursor/Cline/Claude Desktop:

```json
{
  "mcpServers": {
    "private-pub": {
      "command": "ppub",
      "args": ["mcp"]
    }
  }
}
```

PAT thủ công ở trang Tokens vẫn được giữ cho CI; đăng ký secret CI bằng
`ppub --host https://pub.company.dev setup --env-var PRIVATE_PUB_TOKEN`.

Dùng khai báo repository trong `pubspec.yaml`:

```yaml
dependencies:
  aurora_ui:
    hosted: http://localhost:4000
    version: ^2.3.1
```

Không nên đặt `PUB_HOSTED_URL` khi project dùng cả pub.dev và registry private:
Pub không có fallback về pub.dev, nên các package công khai như `flutter_lints`
cũng sẽ bị tìm ở registry private. `ppub upgrade` và `ppub
outdated` không truyền biến này sang Pub; hãy dùng khai báo `hosted:` cho từng
package private như ví dụ trên. Ở demo mode, archive mới publish sẽ được parse,
lập chỉ mục và lưu trong `DEMO_STORAGE_DIR` (mặc định `.private-pub-data/archives`)
để vẫn khả dụng qua các lần khởi động lại API. Dữ liệu demo seed chỉ có metadata;
download archive seed không tồn tại sẽ trả về `404`.

## Tổng quan API

Bề mặt Hosted Pub:

```text
GET  /api/packages/:name
GET  /api/packages/:name/versions/:version
GET  /api/packages/:name/versions/:version.tar.gz
GET  /api/packages/versions/new
POST /api/uploads/:uploadId
GET  /api/packages/versions/newUploadFinish
```

Control plane:

```text
POST   /v1/auth/login
GET    /v1/auth/me
POST   /v1/auth/logout
PATCH  /v1/auth/password
GET    /oauth/authorize
POST   /oauth/authorize
POST   /oauth/token
GET    /v1/admin/accounts
POST   /v1/admin/accounts
GET    /v1/search
GET    /v1/packages/:name
GET    /v1/packages/:name/versions/:version
GET    /v1/packages/:name/versions/:version/files
GET    /v1/packages/:name/versions/:version/files/*path
GET    /v1/packages/:name/versions/:version/score
POST   /v1/imports/pubdev
POST   /v1/imports/file
GET    /v1/imports/:jobId
POST   /v1/analyses/recompute
POST   /v1/tokens
GET    /v1/tokens
DELETE /v1/tokens/:id
POST   /v1/packages/:name/versions/:version/retract
POST   /v1/packages/:name/versions/:version/restore
POST   /v1/packages/:name/discontinue
POST   /v1/packages/:name/undiscontinue
```

## Kiểm tra chất lượng

```bash
pnpm typecheck
pnpm test
pnpm build
```

Bộ kiểm thử API bao phủ metadata Hosted Pub, xếp hạng tìm kiếm, thu hồi/khôi phục, traversal, symlink escape và chỉ mục archive hợp lệ. Bộ kiểm thử worker bao phủ toàn bộ mock pipeline và các khoản trừ điểm.

## Lộ trình tăng cường cho production

Trước khi triển khai ra Internet:

1. Khi cần chạy nhiều API node, chuyển archive từ `ARCHIVE_STORAGE_DIR` sang `S3ArchiveStore` có URL upload/download đã ký, thời hạn ngắn và object key bất biến.
2. Thêm giao diện ủy quyền và thu hồi quyền package owner/writer đang được luồng publish kiểm tra trong database.
3. Parse và lập chỉ mục archive `.tar.gz` trong runner cô lập có giới hạn nén/giải nén, giới hạn entry, timeout, không có network, root filesystem chỉ đọc và CPU/bộ nhớ bị giới hạn.
4. Kết nối hàng đợi bền vững (Valkey/BullMQ, Temporal hoặc cloud queue), idempotency key, retry, xử lý poison job và worker lease.
5. Thêm tích hợp OIDC/JWKS/SSO tùy chọn, quản trị vòng đời tài khoản, MFA, recovery code, xoay token pepper và tích hợp secret manager.
6. Chạy công cụ `pana`/Dart/Flutter thực trong container image đã ghim phiên bản và lưu log/kết quả. Thêm ClamAV hoặc supply-chain scanner phía sau `malware-scan`.
7. Thêm xác minh signed provenance/SBOM, policy gate cho dependency, xác minh domain cho publisher và quy trình phê duyệt.
8. Thêm kiểm thử Playwright E2E, contract test `dart pub get/publish` thực, load test, metrics/traces, backup, diễn tập disaster recovery và quy tắc cache CDN.

Các ranh giới modular monolith là có chủ đích: repository, archive storage, auth, importer, analyzer step, quét malware, xác minh chữ ký và xác minh provenance có thể được thay thế độc lập trước khi tách dịch vụ.
