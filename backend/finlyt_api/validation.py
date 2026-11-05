from __future__ import annotations

from typing import TypeVar

from flask import request
from pydantic import BaseModel

from .errors import ApiError

M = TypeVar("M", bound=BaseModel)


def parse_body(model: type[M]) -> M:
    data = request.get_json(silent=True)
    if data is None:
        raise ApiError(400, "invalid_json", "Request body must be JSON")
    return model.model_validate(data)


def parse_query(model: type[M]) -> M:
    return model.model_validate(request.args.to_dict())
