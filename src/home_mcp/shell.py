"""Running fixed commands locally and over SSH: argv lists only, never a local shell, always bounded by a timeout."""
import asyncio
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

SSH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"]


@dataclass
class Run:
    code: int | None  # None: the command didn't start or timed out
    out: str
    err: str


_agent_socket: str | None = None


def ssh_env() -> dict[str, str]:
    """The environment with an SSH agent socket. MCP clients start stdio servers with a trimmed environment that
    drops SSH_AUTH_SOCK, and a passphrase-protected key (the PC's) then fails; on macOS, launchd still knows it."""
    global _agent_socket
    env = dict(os.environ)
    if not env.get("SSH_AUTH_SOCK"):
        if _agent_socket is None:
            try:
                _agent_socket = subprocess.run(["launchctl", "getenv", "SSH_AUTH_SOCK"], capture_output=True,
                                               text=True, timeout=5).stdout.strip()
            except (OSError, subprocess.SubprocessError):
                _agent_socket = ""
        if _agent_socket:
            env["SSH_AUTH_SOCK"] = _agent_socket
    return env


async def run(argv: list[str], timeout: float = 30) -> Run:
    try:
        proc = await asyncio.create_subprocess_exec(*argv, stdin=asyncio.subprocess.DEVNULL,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                    env=ssh_env() if argv[0] == "ssh" else None)
    except OSError as e:
        return Run(None, "", f"could not start {argv[0]}: {e}")
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return Run(None, "", f"timed out after {timeout:g} s")
    return Run(proc.returncode, out.decode("utf-8", "replace"), clean_stderr(err.decode("utf-8", "replace")))


def clean_stderr(text: str) -> str:
    """stderr without OpenSSH's post-quantum warning, which the Windows PC's server prints on every connection."""
    return "\n".join(line for line in text.splitlines() if not line.startswith("** ")).strip()


def ssh(host: str, command: str) -> list[str]:
    """argv for one fixed remote command. command is a constant from this package, never caller input."""
    return ["ssh", *SSH_OPTIONS, host, command]


def setting(name: str, default: str) -> str:
    return os.environ.get(name) or default


def pi_host() -> str:
    return setting("HOME_MCP_PI_HOST", "pi")


def pc_host() -> str:
    return setting("HOME_MCP_PC_HOST", "windows")


def pihub_repo() -> str:
    return str(Path(setting("HOME_MCP_PIHUB_REPO", "~/dev/pi-hub")).expanduser())


def localai_repo() -> str:
    return str(Path(setting("HOME_MCP_LOCALAI_REPO", "~/dev/ai-harness/LocalAI")).expanduser())
