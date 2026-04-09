
  # PersonalLearning

  ![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
  ![Python](https://img.shields.io/badge/Python-3.x-3776AB?logo=python&logoColor=white)
  ![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?logo=mysql&logoColor=white)
  ![AI](https://img.shields.io/badge/AI-Gemini-00A67E?logo=google&logoColor=white)

  PersonalLearning là nền tảng EdTech ứng dụng AI giúp biến tài liệu học tập thành không gian tự học tương tác. Hệ thống tự động hóa quy trình chắt lọc kiến thức từ nguồn thô và tái cấu trúc thành nội dung học có thể đọc, hỏi đáp, luyện tập. Mục tiêu là rút ngắn thời gian học, tăng độ hiểu sâu và hỗ trợ kiểm tra đánh giá liên tục.

  ## Tính năng nổi bật

  - **Omni-Input**: Nạp dữ liệu đa nguồn từ **URL** (HTML parsing với **readability-lxml**), **Text**, **PDF/DOCX**, **Ảnh** (OCR qua Gemini).
  - **Pedagogical Distillation (AI Theory)**: Sinh bài học **Markdown** theo cấu trúc sư phạm, giữ nguyên **Code/Terminal blocks**, lọc nhiễu tự động.
  - **Strict RAG Q&A Chat**: Chat hỏi đáp bị **khóa chặt theo tài liệu nguồn** (anti-hallucination), hỗ trợ **stream/markdown** và nguyên tắc trả lời có kiểm soát.
  - **Assessment & Mega Quiz**: Tự động tạo **Flashcard** và **Quiz** theo từng bài học; có sẵn luồng chọn nhiều tài liệu trong Thư viện để hướng tới **Mega Quiz (multi-select)**.

  ## Kiến trúc và công nghệ

  ### Frontend
  - **React 18** + **Vite** + **TypeScript**
  - **TailwindCSS** + UI components (Radix-based)
  - Markdown renderer: **react-markdown**, **remark-gfm**, **remark-breaks**, **rehype-highlight**

  ### Backend
  - **FastAPI** (Python)
  - **SQLAlchemy ORM**
  - **Alembic Migration**
  - **MySQL**
  - Hỗ trợ parser: **requests**, **BeautifulSoup4**, **readability-lxml**, **PyPDF2**, **python-docx**

  ### AI Engine
  - **Gemini API (Google Generative Language)**
  - Sử dụng hệ thống **System Prompt** chuyên biệt cho sinh lý thuyết, chat theo tài liệu, và tạo quiz.

  ## Getting Started

  ### 1) Prerequisites

  - **Node.js** 18+
  - **Python** 3.10+
  - **pip**
  - **MySQL** 8+
  - (Khuyến nghị) **Redis** cho quiz cooldown/idempotency scenarios

  ### 2) Setup Backend

  ```bash
  cd backend

  # Tạo môi trường ảo
  python -m venv .venv

  # Kích hoạt (Windows PowerShell)
  .\.venv\Scripts\Activate.ps1

  # Cài dependency
  pip install -r requirements.txt
  ```

  Tạo file môi trường:

  ```bash
  copy .env.example .env
  ```

  Cập nhật các biến quan trọng trong `.env`:

  - `DATABASE_URL` (MySQL)
  - `GEMINI_API_KEY`
  - `GEMINI_MODEL` / `GEMINI_QUIZ_MODEL` / `GEMINI_PRO_MODEL`
  - `REDIS_URL` (nếu sử dụng Redis)

  Chạy migration:

  ```bash
  alembic upgrade head
  ```

  Khởi động backend:

  ```bash
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
  ```

  Kiểm tra nhanh:

  ```bash
  curl http://127.0.0.1:8001/api/health
  ```

  ### 3) Setup Frontend

  ```bash
  cd ..
  npm install
  npm run dev
  ```

  Mặc định frontend chạy Vite và proxy `/api` về backend `http://127.0.0.1:8001`.

  ### 4) Chạy Test

  Unit test backend:

  ```bash
  cd backend
  pytest
  ```

  ## Roadmap

  - Bổ sung **lịch sử điểm số và thống kê tiến độ** theo tuần/tháng cho mỗi học viên.
  - Hỗ trợ **export bài học/quiz ra PDF** để học offline.
  - Mở rộng **đa ngôn ngữ (VI/EN)** cho giao diện và prompt sinh nội dung.
  