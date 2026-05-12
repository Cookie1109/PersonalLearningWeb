# Tài liệu Thiết kế Cơ sở dữ liệu (Database Schema) - Dự án NEXL

Tài liệu này mô tả chi tiết cấu trúc cơ sở dữ liệu của hệ thống **NEXL (PersonalLearningWeb)**. Cơ sở dữ liệu được thiết kế bằng **SQLAlchemy (ORM)** và sử dụng hệ quản trị cơ sở dữ liệu quan hệ (có hỗ trợ kiểu JSON của MySQL/PostgreSQL).

## 1. Tổng quan Kiến trúc Dữ liệu

Cơ sở dữ liệu của NEXL được chia thành 4 nhóm chính, phục vụ cho các module cốt lõi của hệ thống:
1. **Core (Người dùng & Nội dung học tập):** `users`, `roadmaps`, `lessons`.
2. **Learning & Assessment (Đánh giá & Luyện tập):** `quizzes`, `questions`, `quiz_attempts`, `flashcards`, `flashcard_progress`.
3. **AI Interaction (Tương tác AI):** `chat_messages`, `tutor_messages`.
4. **Gamification (Game hóa & Thống kê):** `daily_quests`, `exp_ledger`, `audit_logs`.

---

## 2. Chi tiết các Bảng (Tables)

### 2.1 Nhóm Core: Người dùng và Nội dung

#### `users`
Bảng lưu trữ thông tin người dùng và thống kê quá trình học tập.
- `id` (Integer, PK): ID người dùng tự tăng.
- `email` (String, Unique): Email đăng nhập.
- `firebase_uid` (String, Unique): UID từ Firebase Authentication.
- `password_hash` (String): Mật khẩu (nếu dùng đăng nhập truyền thống).
- `display_name` (String): Tên hiển thị.
- `avatar_url` (String): Link ảnh đại diện.
- `level` (Integer): Cấp độ hiện tại (Gamification).
- `exp` (Integer): Kinh nghiệm hiện tại ở cấp độ này.
- `total_exp` (Integer): Tổng kinh nghiệm tích lũy.
- `current_streak` (Integer): Số ngày học liên tiếp hiện tại.
- `streak` (Integer): Chuỗi ngày học kỷ lục.
- `last_study_date` (Date): Ngày học gần nhất để tính streak.
- *Relationships:* `roadmaps`, `lessons`, `exp_entries`, `daily_quests`, `quiz_attempts`, `audit_logs`, `chat_messages`, `tutor_messages`.

#### `roadmaps`
Bảng lưu trữ các lộ trình học tập do AI tạo ra dựa trên mục tiêu của người dùng.
- `id` (Integer, PK): ID lộ trình.
- `user_id` (Integer, FK): Tham chiếu tới `users.id`.
- `goal` (Text): Mục tiêu học tập gốc của người dùng.
- `title` (String): Tên lộ trình.
- `is_active` (Boolean): Trạng thái kích hoạt.
- *Relationships:* `lessons`.

#### `lessons`
Bảng lưu trữ bài học thuộc các lộ trình hoặc bài học độc lập.
- `id` (Integer, PK): ID bài học.
- `user_id` (Integer, FK): Tham chiếu `users.id`.
- `roadmap_id` (Integer, FK): Tham chiếu `roadmaps.id`.
- `week_number` (Integer): Phân bổ theo tuần.
- `position` (Integer): Thứ tự bài học.
- `title` (String): Tiêu đề bài học.
- `title_normalized` (String): Tiêu đề đã chuẩn hóa không dấu (Dùng cho Search).
- `source_content` (LONGTEXT): Nội dung text thô.
- `source_file_url`, `source_file_public_id`, `source_file_name`, `source_file_mime_type`: Thông tin file tài liệu đính kèm (nếu có).
- `content_markdown` (LONGTEXT): Nội dung đã format Markdown (Do AI sinh ra).
- `youtube_video_id` (String): ID video YouTube đính kèm.
- `version` (Integer): Phiên bản bài học.
- `is_completed` (Boolean): Đánh dấu đã hoàn thành.
- `completed_at` (DateTime): Thời gian hoàn thành.
- *Constraints:* Unique(`user_id`, `title`).
- *Relationships:* `quiz`, `flashcards`, `tutor_messages`, `exp_entries`.

---

### 2.2 Nhóm Learning & Assessment: Đánh giá và Luyện tập

#### `quizzes`
Lưu trữ thông tin bộ câu hỏi Quiz cho một bài học.
- `id` (Integer, PK).
- `lesson_id` (Integer, FK): Tham chiếu tới `lessons.id` (Unique).
- `model_name` (String): Tên model AI dùng để tạo quiz.
- `quiz_content` (JSON): Lưu trữ dự phòng cấu trúc JSON thô của quiz.
- *Relationships:* `questions`, `attempts`.

#### `questions`
Lưu trữ từng câu hỏi trắc nghiệm thuộc một Quiz.
- `id` (Integer, PK).
- `quiz_id` (Integer, FK): Tham chiếu tới `quizzes.id`.
- `question_text` (Text): Nội dung câu hỏi.
- `options_json` (JSON): Danh sách các đáp án (dưới dạng mảng).
- `correct_index` (Integer): Vị trí đáp án đúng (0-based index).
- `explanation` (Text): Lời giải thích từ AI.
- `position` (Integer): Thứ tự câu hỏi trong quiz.
- *Constraints:* Unique(`quiz_id`, `position`).

#### `quiz_attempts`
Lưu trữ lịch sử và kết quả làm bài trắc nghiệm của người dùng.
- `id` (Integer, PK).
- `user_id` (Integer, FK), `quiz_id` (Integer, FK).
- `score` (Integer): Điểm số đạt được.
- `passed` (Boolean): Trạng thái qua môn.
- `reward_granted` (Boolean): Đã cộng điểm EXP hay chưa.
- `selected_answers` (JSON): Đáp án người dùng chọn.
- `answers_json` (JSON): Chi tiết các câu đúng/sai sau khi chấm.

#### `flashcards`
Lưu trữ thẻ ghi nhớ cho mỗi bài học (spaced repetition).
- `id` (Integer, PK).
- `document_id` (Integer, FK): Thực chất là tham chiếu tới `lessons.id`.
- `front_text` (Text): Mặt trước (Câu hỏi / Từ vựng).
- `back_text` (Text): Mặt sau (Câu trả lời / Ý nghĩa).
- `status` (String): Trạng thái học tập (`new`, `got_it`, `missed_it`).

#### `flashcard_progress`
Đánh dấu tiến độ học flashcard của một bài học.
- `id` (Integer, PK).
- `user_id` (Integer, FK), `lesson_id` (Integer, FK).
- `completed_at` (DateTime): Thời gian hoàn thành nhóm flashcard.
- *Constraints:* Unique(`user_id`, `lesson_id`).

---

### 2.3 Nhóm AI Interaction: Tương tác AI

#### `chat_messages`
Lưu trữ lịch sử chat chung của người dùng với hệ thống AI Tutor (Global Chat).
- `id` (Integer, PK).
- `user_id` (Integer, FK): Tham chiếu `users.id`.
- `role` (String): Vai trò người gửi (`user` hoặc `assistant`).
- `content` (Text): Nội dung tin nhắn.

#### `tutor_messages`
Lưu trữ lịch sử chat giữa người dùng và AI Tutor dựa trên Context của một Bài học (Lesson-specific Chat).
- `id` (Integer, PK).
- `user_id` (Integer, FK).
- `lesson_id` (Integer, FK): Tham chiếu `lessons.id` để cung cấp bối cảnh cho AI.
- `role` (String): `user` hoặc `assistant`.
- `content` (Text): Nội dung tin nhắn.

---

### 2.4 Nhóm Gamification: Game hóa & Thống kê

#### `daily_quests`
Lưu trữ các nhiệm vụ hàng ngày của người dùng.
- `id` (String/UUID, PK): ID dạng UUID.
- `user_id` (Integer, FK).
- `quest_code` (String): Mã loại nhiệm vụ.
- `difficulty` (String): Độ khó.
- `action_type` (String): Loại hành động cần làm.
- `title` (String): Tên nhiệm vụ.
- `target_value` (Integer): Mục tiêu cần đạt.
- `current_progress` (Integer): Tiến trình hiện tại.
- `is_completed` (Boolean): Trạng thái hoàn thành.
- `exp_reward` (Integer): Lượng EXP thưởng.
- `quest_date` (Date): Ngày giao nhiệm vụ.
- *Constraints:* Unique(`user_id`, `quest_code`, `quest_date`).

#### `exp_ledger`
Sổ cái ghi nhận mọi giao dịch cộng/trừ điểm kinh nghiệm (EXP) để đảm bảo tính minh bạch và tránh cộng lặp (Idempotency).
- `id` (Integer, PK).
- `user_id` (Integer, FK).
- `lesson_id` (Integer, FK, Nullable).
- `quiz_id` (String, Nullable).
- `action_type` (String): Loại hành động sinh ra EXP.
- `target_id` (String, Nullable): ID đối tượng tham chiếu.
- `reward_type` (String): Loại phần thưởng.
- `exp_amount` (Integer): Lượng EXP giao dịch.
- `metadata_json` (JSON): Dữ liệu đính kèm.
- *Constraints:* 
  - Unique(`user_id`, `quiz_id`, `reward_type`).
  - Unique(`user_id`, `action_type`, `target_id`, `reward_type`).

#### `audit_logs`
Ghi log hoạt động hệ thống cho mục đích bảo mật và giám sát.
- `id` (Integer, PK).
- `user_id` (Integer, FK, Nullable).
- `action` (String): Tên hành động.
- `resource_id` (String, Nullable): ID tài nguyên tác động.
- `details` (JSON): Chi tiết log.

---
*Ghi chú: Tất cả các bảng (trừ một số bảng nhật ký lưu vết tĩnh) đều có các trường `created_at` và `updated_at` (cập nhật tự động) để theo dõi vòng đời của dữ liệu.*
