from __future__ import annotations

import click
from flask import Flask
from sqlalchemy import select

from .auth import create_session
from .db import get_session
from .defaults import seed_user_defaults
from .models import User


def register_cli(app: Flask) -> None:
    @app.cli.command("dev-token")
    @click.argument("email")
    def dev_token(email: str) -> None:
        """Print a session token for EMAIL without going through Google (local testing).

        Creates the user, with default accounts and categories, if needed. A later real
        Google sign-in with the same email takes this user over.
        """
        email = email.strip().lower()
        s = get_session()
        user = s.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(google_sub=f"dev:{email}", email=email, name=email.split("@")[0])
            s.add(user)
            s.flush()
            seed_user_defaults(s, user)
        token = create_session(s, user, device="dev-cli")
        s.commit()
        click.echo(token)
