from __future__ import annotations

import logging
import os
import sys

import uvicorn

from app.main import app


def main() -> None:
    host = os.environ.get("PARALASTRO_BACKEND_HOST", "127.0.0.1")
    port = int(os.environ.get("PARALASTRO_BACKEND_PORT", "8000"))
    log_level = os.environ.get("PARALASTRO_LOG_LEVEL", "info")
    logging.basicConfig(level=log_level.upper())
    uvicorn.run(app, host=host, port=port, log_level=log_level, access_log=False)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logging.exception("Paralastro backend failed to start")
        sys.exit(1)
