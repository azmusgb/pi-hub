import logging

from .server import build_server

logging.getLogger("httpx").setLevel(logging.WARNING)
build_server().run("stdio")
