# Đề Xuất Phát Triển NEXL (Personal Learning Web) Thành Đồ Án Chuyên Ngành

## Luận Điểm Cốt Lõi (Core Thesis Statement)

> **NEXL là hệ thống Micro-Learning thích ứng cá nhân, khai thác Spaced Repetition (FSRS) và Knowledge Graph để tối ưu hóa việc ôn tập từ tài liệu phân mảnh — không yêu cầu tài nguyên AI đắt tiền.**

Dự án NEXL hiện tại đã có nền tảng vững với các tính năng ứng dụng AI (Tạo bài học, Quiz, Flashcard, AI Tutor) và Gamification. Để đưa dự án lên tầm đồ án chuyên ngành **có chiều sâu kỹ thuật**, chiến lược không phải là thêm nhiều tính năng — mà là **đi sâu vào 3 mũi nhọn liên kết chặt chẽ với nhau** thành một hệ thống hoàn chỉnh.

---

## Kiến Trúc 3 Mũi Nhọn (Tích Hợp, Không Phải Tính Năng Độc Lập)

```
Mũi nhọn 1: FSRS + Quiz History  →  Adaptive Review Schedule
Mũi nhọn 2: Keyword Extraction    →  Knowledge Graph  →  Liên kết bài học
Mũi nhọn 3: RAG (hosted embedding) + Grounded Generation  →  Tutor có citation
```

Ba mũi nhọn này nuôi lẫn nhau:
- Knowledge Graph (Mũi 2) cung cấp tags để FSRS (Mũi 1) biết ôn tập theo **concept**, không chỉ theo file.
- Khi FSRS phát hiện người dùng yếu ở một concept, hệ thống gọi RAG Tutor (Mũi 3) để giải thích đúng đoạn tài liệu liên quan.
- Cả 3 cùng tạo ra một vòng lặp học tập cá nhân hóa mà Quizlet/Anki hiện chưa làm được.

---

## 1. Mũi Nhọn 1 — Adaptive Spaced Repetition (FSRS)

**Câu trả lời cho Hội đồng:** *"Em dùng thuật toán SRS nào?"* → FSRS — thuật toán state-of-the-art, được nghiên cứu chứng minh vượt trội SM-2/Leitner, có thư viện Python `py-fsrs` sẵn.

### Tính năng cốt lõi

- **Thuật toán FSRS:** Tính toán thời điểm nhắc lại tối ưu cho từng flashcard dựa trên lịch sử trả lời của người dùng (Again / Hard / Good / Easy). **Không cần AI — thuần logic toán học.**
- **Adaptive Review Schedule:** Mỗi người dùng có lịch ôn tập riêng, tự động cập nhật sau mỗi lần làm Quiz.
- **Knowledge Gap Analysis:** Khi người dùng sai nhiều câu ở một nhóm concept, hệ thống tổng hợp danh sách "điểm yếu" và ưu tiên ôn tập. Dùng `Gemini 2.0 Flash` (free tier) để phân tích pattern lỗi.
- **Đa dạng chế độ học:** Sinh câu hỏi điền từ (fill-in-the-blank), nối từ (matching) từ tài liệu, dùng `Gemini 2.0 Flash`.

### Điểm Tích Hợp Kỹ Thuật — Concept-Level Aggregation Layer

FSRS vận hành ở cấp độ **card** (mỗi flashcard có lịch riêng). Để ôn tập theo *concept* (từ Knowledge Graph), cần một lớp aggregation ở giữa — đây là điểm **kỹ thuật novelty** của NEXL:

```
Concept "Binary Tree"  ← tag từ Knowledge Graph (Mũi 2)
  ├─ Card #1: "BFS là gì?"              → stability=4.2, difficulty=0.7
  ├─ Card #2: "Độ phức tạp inorder?"    → stability=1.1, difficulty=0.9
  └─ Card #3: "Balanced vs Unbalanced?" → stability=2.3, difficulty=0.8

Concept-level weakness score = weighted average of card stabilities
→ Nếu score < threshold → trigger Knowledge Gap Analysis (gọi RAG Tutor, Mũi 3)
```

**Cơ chế cụ thể:**
1. Mỗi card được gắn tag concept từ Knowledge Graph khi tạo.
2. Sau mỗi lần ôn tập, hệ thống tính `weakness_score` cho từng concept = trung bình có trọng số của `stability` của tất cả cards thuộc concept đó (stability thấp = người dùng yếu).
3. Concept nào có `weakness_score < threshold` sẽ được đẩy lên đầu review queue **và** trigger gọi RAG Tutor để giải thích lại.

Nếu Hội đồng hỏi cơ chế này, có thể trả lời chi tiết ở cấp độ thiết kế DB và logic aggregation.

### Công nghệ

| Thành phần | Công nghệ | Chi phí |
|---|---|---|
| Thuật toán SRS | `py-fsrs` (Python) | $0 |
| Lưu lịch sử + concept tags | PostgreSQL | $0 (Supabase free) |
| Concept-level aggregation | Python logic (custom) | $0 |
| Knowledge Gap Analysis | `Gemini 2.0 Flash` | $0 (free tier) |

---

## 2. Mũi Nhọn 2 — Knowledge Graph (Zettelkasten)

**Điểm khác biệt thực sự so với Quizlet/Anki:** Không chỉ học theo file riêng lẻ — hệ thống nhìn thấy **mạng lưới liên kết giữa các khái niệm** xuyên suốt toàn bộ tài liệu của người dùng.

### Tính năng cốt lõi

- **Keyword/Tag Extraction:** Khi user upload tài liệu, dùng `Gemini 2.0 Flash` nhanh chóng trích xuất các từ khóa cốt lõi.
- **Đồ thị mạng nhện (Knowledge Graph):** Backend lưu các tags và quan hệ giữa chúng, Frontend vẽ đồ thị tương tác (D3.js hoặc Vis.js). Giao diện giống Obsidian Graph View.
- **Smart Suggestions:** Khi user học bài A có tag "Binary Tree", hệ thống gợi ý *"Khái niệm này liên quan đến file 'Thuật toán sắp xếp' bạn upload tuần trước — ôn lại không?"*
- **Goal-Oriented Roadmap:** User gõ mục tiêu học ("Ôn thi cuối kỳ môn CTDL"), AI sinh khung sườn dàn ý. Với mỗi mục, user upload tài liệu nhỏ tương ứng → tích tiểu thành đại.

### Tại sao đây là đóng góp học thuật thực sự

Phương pháp Zettelkasten được nghiên cứu về hiệu quả học tập liên kết (Connectivism). NEXL áp dụng vào ngữ cảnh Micro-learning tự động — điều chưa ai implement cho sinh viên Việt Nam ở quy mô này.

### Công nghệ

| Thành phần | Công nghệ | Chi phí |
|---|---|---|
| Keyword extraction | `Gemini 2.0 Flash` | $0 (free tier) |
| Graph database | PostgreSQL (adjacency list) hoặc Neo4j free | $0 |
| Graph visualization | D3.js / Vis.js | $0 |
| Quiz generation (fill-blank, matching) | `Gemini 2.0 Flash` | $0 |

---

## 3. Mũi Nhọn 3 — RAG Tutor với Grounded Generation (Citation-Backed)

**Định nghĩa đúng:** Không phải "Zero Hallucination" — đó là tuyên bố không thể chứng minh kể cả với RAG. Thay vào đó: **"Grounded Generation — mọi câu trả lời đều có citation trỏ đến đoạn văn bản nguồn cụ thể, người dùng tự xác minh được."**

Đây là điều có thể implement và chứng minh trước Hội đồng.

### Tính năng cốt lõi

- **RAG Pipeline chuẩn:** Tài liệu được tách thành `chunks`, embed thành vector, lưu vào pgvector. Khi chat, chỉ query các đoạn liên quan rồi đưa vào prompt cho AI trả lời.
- **Citation UI:** Mỗi câu trả lời của AI Tutor kèm theo trích dẫn cụ thể *"[Nguồn: File 'CTDL.pdf', đoạn trang 3]"*, người dùng click để xem đúng đoạn gốc.
- **Tự xử lý tài liệu lớn hơn 45k chars:** RAG giải quyết giới hạn context bằng retrieval thông minh — không cần tăng limit thủ công.

### Tại sao KHÔNG dùng local embedding (`all-MiniLM-L6-v2`) trên free hosting

| Vấn đề | Giải pháp |
|---|---|
| RAM limit ~512MB trên Render/Railway free | Hosted API, không cần load model |
| Cold start 30–60 giây → demo bị timeout | API response < 1 giây |
| CPU inference chậm với SentenceTransformers | Google infrastructure, production-grade |

**Giải pháp được chọn: `Google text-embedding-004`** (miễn phí trong Google AI Studio, hosted, stable) + **pgvector trên Supabase** (free tier). Vẫn chứng minh đầy đủ kỹ năng build RAG pipeline (chunking, embedding, retrieval, **similarity-based ranking**) mà không rủi ro vận hành khi demo.

> **Lưu ý về "re-ranking":** Tài liệu này dùng thuật ngữ *"similarity-based ranking"* (cosine similarity) — đây là mô tả chính xác của pipeline đang implement. Không tuyên bố Cross-Encoder re-ranking nếu chưa thực sự implement.

### Công nghệ

| Thành phần | Công nghệ | Chi phí |
|---|---|---|
| Embedding | `Google text-embedding-004` | $0 (Google AI Studio) |
| Vector storage | pgvector trên Supabase | $0 (free tier) |
| LLM cho generation | `Gemini 2.5 Flash` | $0 (free tier) |
| Chunking pipeline | Python (LangChain hoặc tự viết) | $0 |

---

## 4. Chiến Lược Model AI (Cập Nhật — Tháng 6/2026)

Do giới hạn ngân sách sinh viên, chiến lược cốt lõi là **kiến trúc luồng dữ liệu (Data Pipeline)** và **thiết kế hệ thống (System Design)** — không phải đua model đắt tiền.

### Phân bổ Model theo Tác vụ

| Tác vụ | Model | Lý do chọn |
|---|---|---|
| Sinh Flashcard, Quiz, Keyword extraction | `Gemini 2.0 Flash` | Nhanh, free tier hào phóng, đủ thông minh cho structured JSON output |
| AI Tutor (RAG generation) | `Gemini 2.5 Flash` | Reasoning mạnh hơn, context 1M token, vẫn free tier |
| Embedding cho RAG | `Google text-embedding-004` | Hosted, stable, không cần tự chạy model |
| Multimodal (PDF có bảng biểu, hình ảnh) | `Gemini 2.0 Flash` (Vision) | Free tier, đọc ảnh trực tiếp từ PDF |

> **⚠️ Lưu ý quan trọng về quota:** Rate limit free tier của Gemini 2.5 Flash đang trong giai đoạn rollout và **thay đổi liên tục**. Trước khi đưa vào báo cáo chính thức, cần vào [aistudio.google.com](https://aistudio.google.com) để xác nhận lại quota thực tế tại thời điểm nộp — tránh bị Hội đồng hỏi số liệu cụ thể mà không trả lời được.

> **Lưu ý:** Tài liệu cũ nhắc đến Gemini 1.5 Flash — phiên bản này đã lỗi thời. Gemini 2.0 Flash nhanh hơn, rẻ hơn, context window lớn hơn, và vẫn có free tier đủ dùng cho đồ án.

### Kỹ thuật Backend để bảo vệ Free Tier

- **Message Queue / Rate Limiting:** Tránh gọi API dồn dập bị lỗi 429. Bố trí hàng đợi xử lý bất đồng bộ.
- **Caching AI Response:** Với tài liệu giống nhau đã được xử lý, trả về cache từ DB — giảm độ trễ từ 15s xuống <1s, tiết kiệm API quota.
  - **Cơ chế phát hiện tài liệu giống nhau:** Hash **SHA-256** của file content trước khi upload. Nếu hash đã tồn tại trong DB → trả về cache ngay, bỏ qua toàn bộ pipeline AI. Chi tiết nhỏ nhưng chứng minh bạn nghĩ đến edge case thực tế.
- **Idempotency Keys:** Xử lý Double-EXP và Double-Request do lag mạng.

Viết kỹ ba kỹ thuật này trong báo cáo — đây là bằng chứng hiểu **System Design thực tế**, không chỉ gọi API.

---

## 5. Framework Đánh Giá (Evaluation Metrics)

Một đồ án chuyên ngành mạnh cần **metrics chứng minh hệ thống hoạt động**. Hội đồng sẽ đánh giá cao khi bạn **biết mình cần đo gì**, dù demo chỉ ở quy mô nội bộ nhỏ.

### Metric 1: FSRS Effectiveness — Within-Subject Design

Thay vì chia nhóm A/B (với 5–10 người dùng thì 2–3 người/nhóm sẽ không có ý nghĩa thống kê), dùng **Within-Subject Design**:

- **Đo:** Cùng một người dùng, theo dõi quiz score **theo thời gian** (tuần 1 → tuần 2 → tuần 3).
- **Vẽ Learning Curve:** Trục X = số lần ôn tập tích lũy, trục Y = tỉ lệ trả lời đúng (%).
- **Retention Rate:** % card được trả lời "Good/Easy" ở lần nhắc lại tiếp theo, so với baseline ngẫu nhiên (không dùng FSRS).
- **Chứng minh:** 5 người dùng × 3 tuần data → learning curve có giá trị, thấy rõ xu hướng cải thiện. Mạnh hơn nhiều so với A/B split ít người.

### Metric 2: Knowledge Gap Analysis Accuracy
- **Đo:** So sánh danh sách "điểm yếu" hệ thống phát hiện với tự đánh giá của người dùng (survey).
- **Chứng minh:** Phân tích lỗi có nghĩa, không phải random.

### Metric 3: RAG Retrieval Precision
- **Đo:** Tạo bộ test thủ công ~20–30 cặp Q&A từ tài liệu đã upload, đánh giá xem RAG có retrieve đúng chunk không (Precision@K).
- **Chứng minh:** Pipeline RAG hoạt động đúng, citation có căn cứ.

### Cách thu thập dữ liệu
- Demo nội bộ với nhóm 5–10 người dùng thật (bạn bè/người thân) trong 2–3 tuần.
- Survey Likert scale (1–5) về mức độ hữu ích của Knowledge Graph suggestions.

---

## 6. Phạm Vi Bảo Vệ (In Scope vs. Out of Scope)

Rõ ràng phân định để Hội đồng không hỏi về những thứ chưa làm:

### ✅ In Scope — Tập trung giải thích kỹ

| Tính năng | Mũi nhọn |
|---|---|
| FSRS Adaptive Review Schedule | Mũi nhọn 1 |
| Concept-level Aggregation Layer (Mũi 1 ↔ Mũi 2) | Mũi nhọn 1+2 |
| Knowledge Gap Analysis (AI + pattern) | Mũi nhọn 1 |
| Keyword Extraction → Knowledge Graph | Mũi nhọn 2 |
| Goal-Oriented Roadmap | Mũi nhọn 2 |
| RAG Pipeline (chunking, embedding, retrieval) | Mũi nhọn 3 |
| Citation-backed AI Tutor | Mũi nhọn 3 |
| Rate Limiting + Message Queue + Caching (SHA-256) | Hạ tầng |
| Gamification (Điểm EXP, Streak) | Đã có sẵn |
| Multimodal PDF (Vision) | Mũi nhọn 3 |

### ❌ Out of Scope — Không cần giải thích kỹ trong bảo vệ

| Tính năng | Lý do loại |
|---|---|
| Community Library + Semantic Search cộng đồng | Cần moderation, auth phân quyền — là một sản phẩm khác |
| Rich Text Block Editor (Notion-like) | Dùng BlockNote/TipTap as-is, không phải đóng góp kỹ thuật của bạn |
| PWA / Offline Sync | Nice-to-have, không phải thesis contribution |
| AI Auto-complete khi gõ | Chưa rõ giải quyết vấn đề học tập gì |

> **Lưu ý:** Các tính năng Out of Scope có thể demo nhẹ nếu đã implement, nhưng không cần diễn giải trong báo cáo như contribution chính.

---

## 7. Câu Trả Lời Cho Hội Đồng

Chuẩn bị sẵn trả lời cho các câu hỏi phổ biến nhất:

**"Em làm được gì mà người khác chưa làm?"**
> NEXL kết hợp FSRS (thuật toán SRS state-of-the-art) với Knowledge Graph theo phương pháp Zettelkasten và RAG citation-backed, tạo vòng lặp học tập thích ứng cá nhân từ tài liệu phân mảnh — thứ mà Quizlet và Anki chưa làm được ở dạng tích hợp này.

**"Em có đảm bảo AI không ảo giác không?"**
> Không cam kết Zero Hallucination — đó là tuyên bố không thể chứng minh. Thay vào đó, em implement Grounded Generation: mọi câu trả lời đều kèm citation trỏ đến đoạn văn bản nguồn, người dùng tự kiểm chứng được.

**"Hệ thống RAG của em accurate như thế nào?"**
> Em đã test với bộ 25 cặp Q&A thủ công và đạt Precision@3 = X%. [Trình bày kết quả đo thực tế.]

**"Tại sao chọn FSRS thay vì SM-2?"**
> FSRS (2022) là thuật toán SRS hiện đại nhất, được nghiên cứu benchmark chứng minh vượt trội SM-2/Leitner trên bộ dữ liệu 20M lần ôn tập. Có thư viện `py-fsrs` Python sẵn, dễ tích hợp.

**"Tại sao không dùng solution có sẵn như LangChain RAG template?"**
> Em tự viết pipeline (chunking strategy, overlap size, retrieval scoring) để kiểm soát và hiểu từng bước. Dùng black-box template không chứng minh được năng lực kỹ thuật — đây là điểm Hội đồng cần thấy ở đồ án chuyên ngành.

**"FSRS hoạt động thế nào ở cấp concept, không chỉ card?"**
> Em implement một Concept-Level Aggregation Layer: mỗi card được gắn tag concept từ Knowledge Graph. Sau mỗi phiên ôn tập, hệ thống tính weakness score = trung bình có trọng số của stability các cards trong concept đó. Nếu score dưới threshold, concept đó được ưu tiên trong review queue và trigger RAG Tutor để giải thích lại.

---

## Tóm Tắt

NEXL đủ sức làm đồ án chuyên ngành nếu **tập trung đi sâu vào 3 mũi nhọn liên kết** thay vì trải rộng. Xương sống kỹ thuật đã đúng hướng — việc cần làm là cắt bớt để có thêm chiều sâu, không phải thêm vào.

| Trước | Sau tối ưu |
|---|---|
| "Nền tảng học tập toàn năng" | "Micro-Learning thích ứng cá nhân với FSRS + Knowledge Graph" |
| 15+ tính năng, nông | 3 mũi nhọn liên kết, sâu |
| Local embedding trên free hosting | Google text-embedding-004 (hosted, stable) |
| "Zero Hallucination" | "Citation-backed Grounded Generation" |
| Gemini 1.5 Flash (cũ) | Gemini 2.0 Flash / 2.5 Flash |
| Không có evaluation | FSRS learning curve + RAG Precision@K + Gap Analysis accuracy |
| A/B split ít người | Within-Subject Design (learning curve theo thời gian) |
| "Re-ranking" (sai thuật ngữ) | "Similarity-based ranking" (cosine similarity — đúng với implement) |
| Caching không giải thích cơ chế | SHA-256 hash → cache hit trước khi vào AI pipeline |