from __future__ import annotations


def test_extract_text_from_html_filters_layout_noise(monkeypatch) -> None:
    import app.services.parser_service as parser_service

    # Force heuristic path to validate selector/noise cleanup behavior deterministically.
    monkeypatch.setattr(parser_service, "ReadabilityDocument", None)

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

    class FakeResponse:
        def __init__(self) -> None:
            self.content = b"<html>ok</html>"
            self.headers = {"content-type": "text/html; charset=utf-8"}
            self.text = """
            <html>
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

    extracted = parser_service.extract_text_from_url(url="https://example.com/blog-post")

    assert "Parsing URL Content" in extracted
    assert "Main body should survive cleanup." in extracted
    assert "Header noise" not in extracted
    assert "Footer noise" not in extracted
