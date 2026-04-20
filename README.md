
# PersonalLearningWeb (NEXL)

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.116-009688?logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?logo=mysql&logoColor=white)

NEXL là nền tảng học tập tích hợp AI: chuyển tài liệu nguồn thành Workspace để học lý thuyết, chat hỏi đáp, luyện flashcard, làm quiz và theo dõi tiến độ bằng gamification.

## 1) Tính năng hiện có

- Tạo Workspace từ text, URL, file PDF/DOCX.
- Trích xuất nội dung nguồn (parser) và chuẩn hóa để học.
- Sinh nội dung bài học theo lesson.
- Chat hỏi đáp theo tài liệu của người dùng.
- Flashcard: generate, cập nhật trạng thái, giải thích mặt sau.
- Quiz: generate, làm bài, nộp bài, chấm điểm và thưởng EXP theo luật backend.
- Gamification:
  - Daily Quest cố định theo ngày (UTC+7).
  - Streak trạng thái ACTIVE/PENDING/LOST.
  - Heatmap hoạt động theo năm.
  - Total study days đồng bộ từ backend profile.

## 2) Kiến trúc công nghệ

### Frontend

- React 18 + Vite + TypeScript
- Tailwind CSS + Radix UI
- Axios + Firebase Web Auth

### Backend

- FastAPI
- SQLAlchemy ORM + Alembic
- MySQL (runtime), SQLite (nhiều test case)
- Redis (cooldown/idempotency/rate-limit)
- Firebase Admin (verify ID token)
- Gemini API (generation/chat)

## 3) Cấu trúc thư mục chính

```text
.
├── src/                 # Frontend app
├── backend/
│   ├── app/             # FastAPI source
│   ├── alembic/         # Migration scripts
│   └── tests/           # Backend tests
├── package.json         # Frontend scripts
└── README.md
```

## 4) Yêu cầu hệ thống

- Node.js 18+
- Python 3.11+
- MySQL 8+
- Redis (khuyến nghị rất mạnh, đặc biệt cho quiz cooldown/idempotency)

## 5) Chạy local

### Bước A - Backend

```bash
cd backend

# Tạo venv
python -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# Cài dependencies
pip install -r requirements.txt

# Tạo env backend
copy .env.example .env

# Chạy migration
alembic upgrade head

# Run API
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

Backend base URL mặc định: http://127.0.0.1:8001

### Bước B - Frontend

```bash
cd ..
npm install
npm run dev
```

Frontend mặc định proxy /api sang http://127.0.0.1:8001 (xem vite.config.ts).

## 6) Cấu hình môi trường

### 6.1 Backend: backend/.env

Các biến quan trọng (xem đầy đủ trong backend/.env.example):

- APP_HOST, APP_PORT, API_PREFIX
- DATABASE_URL
- REDIS_URL
- FIREBASE_PROJECT_ID
- FIREBASE_CREDENTIALS_PATH hoặc FIREBASE_CREDENTIALS_JSON
- GEMINI_API_KEY, GEMINI_MODEL, GEMINI_QUIZ_MODEL, GEMINI_PRO_MODEL
- QUIZ_PASS_SCORE, QUIZ_PASS_REWARD_EXP
- DAILY_QUEST_RESET_TIMEZONE (mặc định Asia/Ho_Chi_Minh)
- DAILY_QUEST_ALL_CLEAR_BONUS_EXP
- CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

### 6.2 Frontend: .env (tại root project)

Ví dụ:

```bash
VITE_API_BASE_URL=/api

VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=... # optional
```

Lưu ý: frontend và backend phải dùng cùng Firebase project để verify token hoạt động đúng.

## 7) Scripts hữu ích

### Frontend

```bash
npm run dev
npm run test
npm run build
```

### Backend

```bash
cd backend
pytest
alembic upgrade head
alembic revision --autogenerate -m "your_migration_name"
```

## 8) API chính (rút gọn)

Prefix mặc định: /api

### Health

- GET /health

### Auth/Profile

- GET /auth/me
- PATCH /auth/me
- POST /auth/avatar
- GET /auth/activity

### Parser

- POST /parser/extract-text

### Documents

- POST /documents
- POST /documents/upload
- GET /documents
- GET /documents/paged
- PATCH /documents/{doc_id}
- DELETE /documents/{doc_id}
- POST /documents/{document_id}/chat
- GET /documents/{document_id}/flashcards
- POST /documents/{document_id}/flashcards/generate
- GET /documents/{document_id}/quiz
- POST /documents/{document_id}/quiz/generate
- POST /documents/{document_id}/quiz/submit

### Lessons / Quizzes

- GET /lessons/{lesson_id}
- POST /lessons/{lesson_id}/generate
- GET /lessons/{lesson_id}/quiz
- POST /lessons/{lesson_id}/quiz/generate
- POST /lessons/{lesson_id}/flashcards/complete
- POST /lessons/{lesson_id}/complete
- POST /quizzes/{quiz_id}/submit

### Flashcards

- PATCH /flashcards/{card_id}/status
- POST /flashcards/{card_id}/explain

### Chat

- POST /chat
- GET /chat/history

### Gamification

- GET /gamification/profile
- GET /gamification/quests
- POST /gamification/track
- GET /gamification/heatmap?year=YYYY

## 9) Quy tắc gamification đang áp dụng

- Local day dùng UTC+7 cho các chỉ số ngày học/gamification.
- Daily quest reset theo DAILY_QUEST_RESET_TIMEZONE (mặc định Asia/Ho_Chi_Minh).
- Profile gamification trả current_streak (raw), display_streak và streak_status (ACTIVE/PENDING/LOST).
- total_study_days tính từ exp_ledger theo bucket ngày local UTC+7.
- auth/activity và heatmap đều aggregate theo local UTC+7.

## 10) Kiểm tra nhanh sau khi bật hệ thống

- Health: http://127.0.0.1:8001/api/health
- OpenAPI: http://127.0.0.1:8001/docs
- Frontend: http://127.0.0.1:5173

## 11) Troubleshooting nhanh

- 401 ở API protected:
  - Kiểm tra token Firebase ở frontend.
  - Kiểm tra FIREBASE_PROJECT_ID và credential ở backend.
- Không upload avatar được:
  - Kiểm tra CLOUDINARY_* trong backend/.env.
- Quiz cooldown/rate-limit không hoạt động đúng:
  - Kiểm tra REDIS_URL và trạng thái Redis.
- Migration lỗi kết nối:
  - Kiểm tra DATABASE_URL và quyền user MySQL.

---

Nếu cần mở rộng README cho production deployment (Docker, CI/CD, monitoring, backup DB), có thể bổ sung thêm mục Deployment Guide riêng.
  