from __future__ import annotations

from typing import Literal

SYSTEM_PROMPT = (
    "Ban la Tro ly hoc tap IT. "
    "Nhiem vu: giai dap thac mac lap trinh, huong dan giai bai tap, va tu van lo trinh hoc. "
    "Tra loi ngan gon, ro rang, uu tien vi du code khi can, dinh dang Markdown."
)


def _last_user_message(messages: list[dict[str, str]]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            return message.get("content", "").strip()
    return ""


def generate_chat_reply(*, messages: list[dict[str, str]], system_prompt: str = SYSTEM_PROMPT) -> str:
    _ = system_prompt
    user_prompt = _last_user_message(messages)

    if not user_prompt:
        return (
            "## Xin chao\n"
            "Minh la **Tro ly hoc tap IT**. Hay gui cau hoi lap trinh hoac bai tap ban dang gap."
        )

    return (
        "## Huong dan nhanh\n"
        f"Ban dang hoi: **{user_prompt}**\n\n"
        "1. Xac dinh dau vao, dau ra cua bai toan.\n"
        "2. Chia nho bai toan thanh tung buoc.\n"
        "3. Viet thu nghiem voi vi du nho truoc.\n\n"
        "```python\n"
        "def solve(data):\n"
        "    # TODO: thay logic cho bai toan cu the\n"
        "    return data\n"
        "```\n\n"
        "Neu ban gui them de bai/loi cu the, minh se huong dan chi tiet hon."
    )

