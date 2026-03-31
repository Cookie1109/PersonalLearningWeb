from __future__ import annotations

import logging

from fastapi import BackgroundTasks

from app.db.session import SessionLocal
from app.models import AuditLog

logger = logging.getLogger("app.audit")


def _write_audit_log(
    *,
    user_id: int | None,
    action: str,
    resource_id: str | None,
    details: dict | None,
) -> None:
    db = SessionLocal()
    try:
        db.add(
            AuditLog(
                user_id=user_id,
                action=action,
                resource_id=resource_id,
                details=details,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "audit.write_failed",
            extra={
                "action": action,
                "resource_id": resource_id,
            },
        )
    finally:
        db.close()


def queue_audit_log(
    background_tasks: BackgroundTasks,
    *,
    user_id: int | None,
    action: str,
    resource_id: str | None = None,
    details: dict | None = None,
) -> None:
    background_tasks.add_task(
        _write_audit_log,
        user_id=user_id,
        action=action,
        resource_id=resource_id,
        details=details,
    )
