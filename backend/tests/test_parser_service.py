from __future__ import annotations

import pytest
from fastapi import HTTPException


def test_extract_text_from_html_filters_layout_noise(monkeypatch) -> None:
    import app.services.parser_service as parser_service

    # Force deterministic fallback path independent from optional extractor libraries.
    monkeypatch.setattr(parser_service, "ReadabilityDocument", None)
    monkeypatch.setattr(parser_service, "NewspaperArticle", None)
    monkeypatch.setattr(parser_service, "trafilatura", None)

    html = """
    <html>
      <body>
        <header>
          <h1>Trang chu</h1>
          <nav>Home | Search | Contact</nav>
        </header>
        <main>
          <article>
            <h2>Khoi noi dung chinh</h2>
            <p>Day la doan mo ta bai viet can trich xuat.</p>
            <p>---</p>
            <p>Thong tin chi tiet ve ky thuat web scraping sach.</p>
            <p><> </p>
          </article>
        </main>
        <aside>Widget tim kiem</aside>
        <footer>Ban quyen 2026</footer>
      </body>
    </html>
    """

    extracted = parser_service._extract_text_from_html(html)

    assert "Khoi noi dung chinh" in extracted
    assert "doan mo ta bai viet" in extracted
    assert "Thong tin chi tiet" in extracted
    assert "Trang chu" not in extracted
    assert "Widget tim kiem" not in extracted
    assert "Ban quyen" not in extracted
    assert "---" not in extracted
    assert "<>" not in extracted


def test_extract_text_from_url_does_not_crash_and_returns_clean_content(monkeypatch) -> None:
    import app.services.parser_service as parser_service

    monkeypatch.setattr(parser_service, "ReadabilityDocument", None)
    monkeypatch.setattr(parser_service, "NewspaperArticle", None)
    monkeypatch.setattr(parser_service, "trafilatura", None)

    class FakeResponse:
        def __init__(self) -> None:
            self.content = b"<html>ok</html>"
            self.headers = {"content-type": "text/html; charset=utf-8"}
            self.text = """
            <html>
              <head><title>My test title</title></head>
              <body>
                <header>Header noise</header>
                <article>
                  <h1>Parsing URL Content</h1>
                  <p>Main body should survive cleanup.</p>
                </article>
                <footer>Footer noise</footer>
              </body>
            </html>
            """

        def raise_for_status(self) -> None:
            return None

    def _fake_get(url: str, timeout: int, headers: dict[str, str], allow_redirects: bool):
        _ = (url, timeout, headers, allow_redirects)
        return FakeResponse()

    monkeypatch.setattr(parser_service.requests, "get", _fake_get)

    extracted, extracted_title = parser_service.extract_text_from_url(url="https://example.com/blog-post")

    assert "Parsing URL Content" in extracted
    assert "Main body should survive cleanup." in extracted
    assert "Header noise" not in extracted
    assert "Footer noise" not in extracted
    assert extracted_title == "My test title"



def test_extract_text_from_url_rejects_text_over_45000_chars(monkeypatch) -> None:
    import app.services.parser_service as parser_service

    class FakeResponse:
        def __init__(self) -> None:
            self.content = b"<html>ok</html>"
            self.headers = {"content-type": "text/html; charset=utf-8"}
            self.text = "<html><body><article>Long content</article></body></html>"

        def raise_for_status(self) -> None:
            return None

    def _fake_get(url: str, timeout: int, headers: dict[str, str], allow_redirects: bool):
        _ = (url, timeout, headers, allow_redirects)
        return FakeResponse()

    monkeypatch.setattr(parser_service.requests, "get", _fake_get)
    monkeypatch.setattr(
        parser_service,
        "_extract_text_from_html",
        lambda html_text, *, url=None: "A" * 45001,
    )

    with pytest.raises(HTTPException) as exc_info:
        parser_service.extract_text_from_url(url="https://example.com/very-long")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == (
        "Nội dung trang web quá dài (vượt quá 45.000 ký tự). "
        "Vui lòng chọn một đường dẫn khác chứa ít nội dung hơn để đảm bảo AI xử lý tốt nhất."
    )


def test_extract_text_from_uploaded_file_uses_filename_as_title(monkeypatch) -> None:
    import app.services.parser_service as parser_service

    monkeypatch.setattr(
        parser_service,
        "extract_text_from_docx_bytes",
        lambda *, file_bytes: "Core doc content",
    )

    extracted, source_type, mime_type, extracted_title = parser_service.extract_text_from_uploaded_file(
        file_name="Python Async Notes.docx",
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        file_bytes=b"fake-docx",
    )

    assert source_type == "docx"
    assert mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert extracted == "Core doc content"
    assert extracted_title == "Python Async Notes"


def test_extract_text_from_html_prefers_smart_extractor_output(monkeypatch) -> None:
    import app.services.parser_service as parser_service

    monkeypatch.setattr(parser_service, "ReadabilityDocument", None)
    monkeypatch.setattr(parser_service, "NewspaperArticle", None)

    class _FakeTrafilatura:
        @staticmethod
        def extract(*args, **kwargs):
            _ = (args, kwargs)
            return "Noi dung chinh duoc trich xuat thong minh"

    monkeypatch.setattr(parser_service, "trafilatura", _FakeTrafilatura())

    html = """
    <html>
      <body>
        <header>Noise header</header>
        <article><p>Noi dung chinh duoc trich xuat thong minh</p></article>
        <footer>Noise footer</footer>
      </body>
    </html>
    """

    extracted = parser_service._extract_text_from_html(html, url="https://example.com")

    assert extracted == "Noi dung chinh duoc trich xuat thong minh"



def test_extract_text_from_uploaded_file_rejects_text_over_45000_chars(monkeypatch) -> None:
    import app.services.parser_service as parser_service

    monkeypatch.setattr(
        parser_service,
        "extract_text_from_pdf_bytes",
        lambda *, file_bytes: "A" * 45001,
    )

    with pytest.raises(HTTPException) as exc_info:
        parser_service.extract_text_from_uploaded_file(
            file_name="long.pdf",
            content_type="application/pdf",
            file_bytes=b"fake-pdf",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == (
        "Tài liệu quá dài (vượt quá giới hạn an toàn ~20 trang/45.000 ký tự). "
        "Vui lòng cắt nhỏ tài liệu theo từng chương để AI xử lý chính xác nhất."
    )
