# Hướng Dẫn Chạy Dự Án Bằng Docker Từ A-Z

Tài liệu này hướng dẫn chi tiết cách thiết lập, khởi chạy và quản lý dự án **Constellation (private pub)** bằng Docker và Docker Compose từ đầu đến cuối.

---

## 📋 Mục lục
1. [Yêu cầu hệ thống](#-yêu-cầu-hệ-thống)
2. [Cách Cơ sở dữ liệu được tạo và khởi tạo](#-cách-cơ-sở-dữ liệu-được-tạo-và-khởi-tạo)
3. [Các bước khởi chạy chi tiết (Local Development)](#-các-bước-khởi-chạy-chi-tiết-local-development)
4. [Tài khoản mặc định & Nạp dữ liệu mẫu (Seed)](#-tài-khoản-mặc-định--nạp-dữ-liệu-mẫu-seed)
5. [Các lệnh quản trị Database trong Docker](#-các-lệnh-quản-trị-database-trong-docker)
6. [Cấu hình chạy Production](#-cấu-hình-chạy-production)
7. [Xử lý sự cố thường gặp (Troubleshooting)](#-xử-lý-sự-cố-thường-gặp-troubleshooting)

---

## 💻 Yêu cầu hệ thống
Trước khi bắt đầu, hãy đảm bảo máy tính của bạn đã cài đặt các công cụ sau:
* **Docker Desktop** (bao gồm Docker Engine và Docker Compose) -> [Tải tại đây](https://www.docker.com/products/docker-desktop/)
* **Git** (để quản lý mã nguồn)

---

## 🗄 Cách Cơ sở dữ liệu được tạo và khởi tạo

> [!NOTE]
> **Bạn KHÔNG cần chạy bất kỳ lệnh SQL nào để tạo cơ sở dữ liệu hoặc tạo bảng thủ công.**

Quy trình tự động của Docker diễn ra như sau:
1. **Tạo Database:** Khi container `postgres` khởi động lần đầu tiên, hình ảnh PostgreSQL chính thức sẽ tự động tạo một database trống dựa trên tên được khai báo trong biến `POSTGRES_DB` ở file `.env` (mặc định là `private_pub`).
2. **Tạo cấu trúc bảng (Schema):** Khi container `api` chạy lên, lệnh khởi động của nó sẽ gọi `pnpm db:deploy` trước khi chạy backend. Lệnh này sẽ áp dụng tất cả các tệp di chuyển (migrations) của Prisma để tự động tạo cấu trúc bảng dữ liệu hoàn chỉnh.

Các biến cấu hình database mặc định nằm trong file `.env`:
```env
POSTGRES_USER=private_pub
POSTGRES_PASSWORD=private_pub
POSTGRES_DB=private_pub
```

---

## 🚀 Các bước khởi chạy chi tiết (Local Development)

### Bước 1: Sao chép tệp cấu hình môi trường
Từ thư mục gốc của dự án, sao chép file `.env.example` thành `.env`:
```bash
cp .env.example .env
```

### Bước 2: Khởi chạy các container Docker
Chạy lệnh dưới đây để tải về/build image và chạy các container ở chế độ nền (background):
```bash
docker compose up --build -d
```
*Lưu ý: Quá trình build lần đầu tiên sẽ mất khoảng vài phút do Docker cần tải môi trường Node.js và thiết lập Flutter SDK bên trong container.*

### Bước 3: Xác minh các dịch vụ đang chạy
Kiểm tra danh sách các dịch vụ và trạng thái của chúng bằng lệnh:
```bash
docker compose ps
```
Nếu tất cả các dịch vụ đều báo trạng thái `Up` (hoặc `healthy`), dự án đã sẵn sàng hoạt động tại các địa chỉ:
* 🌐 **Ứng dụng Web (Frontend - Next.js):** [http://localhost:3000](http://localhost:3000)
* ⚙️ **API Gateway (Fastify):** [http://localhost:4000](http://localhost:4000)
* 📖 **OpenAPI Swagger UI:** [http://localhost:4000/docs](http://localhost:4000/docs)
* 🩺 **API Healthcheck:** [http://localhost:4000/health](http://localhost:4000/health)

---

## 🔑 Tài khoản mặc định & Nạp dữ liệu mẫu (Seed)

### 1. Tài khoản mặc định ban đầu
Trong môi trường phát triển (`.env`), hệ thống tự động thiết lập một tài khoản quản trị viên tối cao:
* **Username:** `admin`
* **Password:** `admin`

> [!IMPORTANT]
> Tài khoản này được đánh dấu là bắt buộc đổi mật khẩu. Lần đầu truy cập trang quản trị tại [http://localhost:3000/login](http://localhost:3000/login), bạn phải đổi mật khẩu mới để có thể tiếp tục sử dụng các tính năng khác (như tạo token hoặc tải lên package).

### 2. Nạp dữ liệu mẫu (Seed Data)
Để tạo các dữ liệu thử nghiệm như thông tin publisher mẫu, các package mẫu vào database mới tinh, hãy chạy lệnh seed trực tiếp vào container `api` đang chạy:
```bash
docker compose exec api pnpm db:seed
```

---

## 🔧 Các lệnh quản trị Database trong Docker

Nếu cần thực hiện các thao tác quản trị cơ sở dữ liệu trong quá trình phát triển:

### Áp dụng migration thủ công
Khi bạn cập nhật Prisma schema hoặc có file migration mới từ git:
```bash
docker compose exec api pnpm db:deploy
```

### Reset database (Xóa sạch dữ liệu và tạo lại các bảng từ đầu)
Nếu dữ liệu test bị lỗi và bạn muốn reset database về trạng thái trống ban đầu:
```bash
docker compose exec api pnpm --filter @private-pub/database exec prisma migrate reset
```
*(Gõ `y` và nhấn Enter khi hệ thống yêu cầu xác nhận)*

### Sử dụng Prisma Studio để xem/sửa dữ liệu trực quan
Bạn có thể khởi động giao diện quản lý cơ sở dữ liệu Prisma Studio trực tiếp trên máy của mình bằng cách kết nối với cổng PostgreSQL đang được Docker export ra ngoài (`5432`):
```bash
# 1. Export chuỗi kết nối cục bộ (chạy trên Terminal của máy host)
export DATABASE_URL='postgresql://private_pub:private_pub@localhost:5432/private_pub?schema=public'

# 2. Chạy Prisma Studio
pnpm --filter @private-pub/database exec prisma studio
```
Sau đó, truy cập giao diện quản trị dữ liệu tại: [http://localhost:5555](http://localhost:5555)

---

## 🛡 Cấu hình chạy Production
Khi đưa dự án lên môi trường chạy thực tế, bảo mật là yếu tố quan trọng nhất. Hãy làm theo các bước sau:

1. Tạo file cấu hình môi trường production riêng biệt:
   ```bash
   cp .env.production.example .env.production
   ```
2. Mở file `.env.production` và thay thế toàn bộ giá trị có chữ `CHANGE_ME`:
   * Thay đổi `POSTGRES_PASSWORD` và đường dẫn `DATABASE_URL`.
   * Cấu hình lại `TOKEN_PEPPER` bằng một chuỗi ký tự ngẫu nhiên, dài và phức tạp.
   * Cài đặt `DEFAULT_ADMIN_PASSWORD` (tối thiểu 16 ký tự).
   * Cập nhật `PUBLIC_BASE_URL` và `CORS_ORIGINS` bằng domain thật của bạn (sử dụng giao thức `https://`).
3. Khởi chạy Docker Compose chỉ định file môi trường production:
   ```bash
   docker compose --env-file .env.production up --build -d
   ```

---

## 🔍 Xử lý sự cố thường gặp (Troubleshooting)

### Lỗi cổng 3000, 4000 hoặc 5432 bị chiếm dụng
* **Mô tả:** Lỗi khi chạy docker compose báo không thể bind cổng.
* **Khắc phục:** Máy của bạn đang chạy một dịch vụ NodeJS local hoặc Database Postgres local trùng cổng. Hãy tắt dịch vụ đó đi (ví dụ: chạy `sudo pg_ctlcluster 17 main stop` đối với Postgres trên Linux/Mac hoặc tắt dịch vụ Postgres trong Services trên Windows).

### Đăng nhập thất bại hoặc lỗi phân quyền admin
* **Khắc phục:** Nếu bạn thay đổi mật khẩu admin và quên, hoặc database khởi tạo lỗi, hãy chạy lệnh reset database ở phần trên, hoặc xóa hoàn toàn Docker Volume chứa dữ liệu Postgres để Docker dựng lại database trống từ đầu:
  ```bash
  docker compose down --volumes
  ```
  *(Lưu ý: Lệnh này sẽ xóa sạch dữ liệu packages đã upload của bạn)*

### Muốn xem log của một container cụ thể
* Để xem log trực tiếp theo thời gian thực (ví dụ service API):
  ```bash
  docker compose logs -f api
  ```
  *(Thay `api` bằng `web`, `worker`, `postgres`, hoặc `redis` tùy ý)*
