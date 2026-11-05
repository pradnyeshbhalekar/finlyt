from __future__ import annotations

import logging
from typing import Any

from flask import Flask, jsonify
from pydantic import ValidationError
from werkzeug.exceptions import HTTPException

log = logging.getLogger(__name__)


class ApiError(Exception):
    """An error that becomes a JSON response: {"error": {"code", "message", "details"?}}."""

    def __init__(self, status: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def error_body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return {"error": error}


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def _api_error(e: ApiError):
        return jsonify(error_body(e.code, e.message, e.details)), e.status

    @app.errorhandler(ValidationError)
    def _validation_error(e: ValidationError):
        details = [
            {"loc": [str(part) for part in err["loc"]], "msg": err["msg"]}
            for err in e.errors(include_url=False, include_input=False)
        ]
        return jsonify(error_body("validation_error", "Invalid request", details)), 422

    @app.errorhandler(HTTPException)
    def _http_error(e: HTTPException):
        code = (e.name or "error").lower().replace(" ", "_")
        return jsonify(error_body(code, e.description or e.name or "Error")), e.code or 500

    @app.errorhandler(Exception)
    def _unhandled(e: Exception):
        log.exception("Unhandled error")
        return jsonify(error_body("internal_error", "Something went wrong")), 500
