"""Entrypoint for Vercel and for `uv run flask --app app run`."""

from dotenv import load_dotenv

# Local development reads backend/.env; on Vercel the variables come from project settings.
load_dotenv()

from finlyt_api import create_app  # noqa: E402

app = create_app()
