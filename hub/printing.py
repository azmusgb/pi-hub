"""Print from the hub to the HP DeskJet through CUPS, see the queue, cancel jobs, read ink."""
import os
import re
import subprocess
import tempfile

from . import sources

PRINTER = os.environ.get("HUB_PRINTER", "HP_DeskJet_4200_series_8D1A40_")
ALLOWED = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
           ".txt": "text/plain"}
MAX_BYTES = 25 * 1024 * 1024
JOB_ID = re.compile(rf"^{re.escape(PRINTER)}-\d+$")


def _run(*cmd, timeout=20):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def printer_state():
    out = _run("lpstat", "-p", PRINTER).stdout.strip()
    if not out:
        return {"name": "HP DeskJet 4200", "state": "Not found"}
    state = "Ready" if " is idle" in out else "Printing" if "now printing" in out else \
        "Paused" if "disabled" in out else "Ready"
    return {"name": "HP DeskJet 4200", "state": state}


def _ink():
    uri = _run("lpstat", "-v", PRINTER).stdout.split(": ", 1)[-1].strip()
    if not uri.startswith("ipp"):
        return None
    out = _run("ipptool", "-tv", uri, "get-printer-attributes.test", timeout=15).stdout
    names = re.search(r"marker-names \([^)]*\) = (.+)", out)
    levels = re.search(r"marker-levels \([^)]*\) = (.+)", out)
    if not names or not levels:
        return None
    pretty = {"tri-color ink": "Colour", "black ink": "Black"}
    return [{"name": pretty.get(n.strip(), n.strip().capitalize()), "level": int(l)}
            for n, l in zip(names.group(1).split(","), levels.group(1).split(",")) if l.strip().lstrip("-").isdigit()]


def ink():
    return sources.cached("ink", 600, _ink)


def _jobs(which):
    out = _run("lpstat", "-W", which, "-o", PRINTER).stdout
    jobs = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 3 and JOB_ID.match(parts[0]):
            jobs.append({"id": parts[0], "number": parts[0].rsplit("-", 1)[1], "who": parts[1],
                         "size": int(parts[2]) if parts[2].isdigit() else None,
                         "when": " ".join(parts[3:])})
    return jobs


def jobs():
    return {"waiting": _jobs("not-completed"), "done": _jobs("completed")[-8:][::-1]}


def submit(data, filename, copies=1, mono=False):
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in ALLOWED:
        raise ValueError("That file type can't be printed. Use a PDF, JPG, PNG or text file.")
    if not data:
        raise ValueError("The file is empty.")
    if len(data) > MAX_BYTES:
        raise ValueError("That file is over 25 MB.")
    copies = max(1, min(int(copies), 20))
    title = re.sub(r"[^\w .-]", "", os.path.basename(filename))[:60] or "Print"
    with tempfile.NamedTemporaryFile(suffix=ext) as f:
        f.write(data)
        f.flush()
        cmd = ["lp", "-d", PRINTER, "-n", str(copies), "-t", title,
               "-o", f"print-color-mode={'monochrome' if mono else 'color'}"]
        if ext in (".jpg", ".jpeg", ".png"):
            cmd += ["-o", "fit-to-page"]
        r = _run(*cmd, f.name, timeout=60)
    if r.returncode != 0:
        raise RuntimeError("The printer didn't accept the job. Check it's switched on.")
    m = re.search(r"request id is (\S+)", r.stdout)
    return {"id": m.group(1) if m else None, "title": title, "copies": copies}


def cancel(job_id):
    if not JOB_ID.match(job_id):
        raise ValueError("Unknown print job.")
    r = _run("cancel", job_id)
    if r.returncode != 0:
        raise RuntimeError("That job couldn't be cancelled. It may have finished already.")
