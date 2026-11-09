"""A19 P5: the layers of a sliced Quick Print job, read from the sliced file itself (never from the model).

One streamed pass over `Metadata/plate_1.gcode` in the stored 3MF writes a sidecar next to the slice (one JSON line of
geometry per layer) and builds a small per-layer summary the page can draw at once. The page then asks for one layer at a
time. A feature the file doesn't say (the seam, an arc's curve) is not guessed: an arc is drawn as its chord, retractions
and wipes are travel, and a file that isn't in relative-extrusion mode is refused ("unavailable"), because then which move
extrudes can't be read from it.

The pass runs in one background thread at a time, with a budget of bytes, layers and seconds; past a budget the layers
read so far stay and the summary says the rest was not read. Nothing here runs G-code, writes to a printer or opens a path
outside the job's own slice."""
import json
import re
import threading
import time
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from . import quick
from .quick_check import MAX_GCODE, MAX_LINE, _lines

MAX_LAYERS = 5000
MAX_SIDECAR = 96 * 1024 * 1024
BUDGET_SECONDS = 600
VERSION = 2
_WORD = re.compile(rb"([XYEFZ])(-?\d*\.?\d+)")
_lock = threading.Lock()  # one pass at a time on the Pi
_builds: dict[str, dict] = {}  # job id -> {key, state, progress, layers, offsets, reason, ...}
_guard = threading.Lock()


def _sidecar(job: dict) -> Path | None:
    p = quick.slice_path(job)
    return p.with_name(p.name + ".layers") if p else None


def sidecar_path(job: dict) -> Path | None:
    return _sidecar(job)


def _summary_path(side: Path) -> Path:
    return side.with_name(side.name + ".json")


def _r(v: float) -> float:
    return round(v, 2)


def parse(path: Path, side: Path, status: dict, now=time.monotonic) -> None:
    """Read the plate's G-code once, writing `side` (a `.part` first) and filling `status` (layers, offsets, progress).
    Sets status['state'] to ready, unavailable or failed; never raises."""
    part = side.with_name(side.name + ".part")
    try:
        _parse(path, part, status, now)
        if status["state"] == "building":
            part.replace(side)
            _summary_path(side).write_text(json.dumps({
                "v": VERSION, "layers": status["layers"], "offsets": status["offsets"], "bounds": status["bounds"],
                "truncated": status["truncated"], "e_filament": status["e_filament"], "plate": status["plate"]}, separators=(",", ":")))
            status["state"] = "ready"
    except (zipfile.BadZipFile, KeyError, OSError, EOFError, ValueError) as e:
        status.update(state="failed", reason=f"The layers couldn't be read from the sliced file ({type(e).__name__}).")
    finally:
        if status["state"] != "ready":
            part.unlink(missing_ok=True)
            side.unlink(missing_ok=True)
            _summary_path(side).unlink(missing_ok=True)


def _parse(path: Path, part: Path, status: dict, now) -> None:
    name = "Metadata/plate_1.gcode"
    started = now()
    x = y = 0.0
    speed = None  # mm/s, as the file's own F word says
    feature = ""
    rel = None  # relative extrusion (M83) is required; absolute (M82) can't be read here
    layers: list[dict] = status["layers"]
    offsets: list[int] = status["offsets"]
    cur: dict | None = None
    run: list | None = None  # the open extrusion polyline (flat x, y, x, y, ...)
    trun: list | None = None  # the open travel polyline
    lo = [1e9, 1e9]
    hi = [-1e9, -1e9]
    written = 0
    read = 0
    count = 0

    with zipfile.ZipFile(path) as z, open(part, "wb") as out, z.open(name) as f:
        total = max(z.getinfo(name).file_size, 1)

        def flush():
            nonlocal written
            if cur is None:
                return
            ext_len = sum(r["len"] for r in cur["runs"])
            geo = {"i": cur["i"], "z": cur["z"], "extrusion": [{"f": r["f"], "s": r["s"], "p": r["p"]} for r in cur["runs"]],
                   "travel": cur["travel"]}
            line = (json.dumps(geo, separators=(",", ":")) + "\n").encode()
            offsets.append(written)
            out.write(line)
            out.flush()
            written += len(line)
            speeds = [r["s"] for r in cur["runs"] if r["s"] is not None]
            layers.append({"i": cur["i"], "z": cur["z"], "extrusion_mm": _r(ext_len), "travel_mm": _r(cur["tlen"]),
                           "filament_mm": _r(cur["e"]), "features": cur["features"],
                           "speed": [min(speeds), max(speeds)] if speeds else None, "bytes": len(line)})

        for raw, too_long in _lines(f):
            read += len(raw) + 1
            count += 1
            if read > MAX_GCODE or too_long:
                status.update(state="failed", reason="The G-code is larger than the layer reader accepts.")
                return
            if count % 20000 == 0:
                status["progress"] = min(read / total, 1.0)
                if now() - started > BUDGET_SECONDS:
                    status["truncated"] = f"Reading stopped after {BUDGET_SECONDS // 60} minutes; the layers after {len(layers)} were not read."
                    break
                time.sleep(0)  # let the hub's own requests in
            line = raw.strip()
            if not line:
                continue
            if line[:1] == b";":
                if line.startswith(b"; CHANGE_LAYER"):
                    flush()
                    if len(layers) >= MAX_LAYERS or written >= MAX_SIDECAR:
                        status["truncated"] = f"Only the first {len(layers)} layers are drawn here; the rest is too large to show."
                        cur = None
                        break
                    cur = {"i": len(layers), "z": 0.0, "runs": [], "travel": [], "tlen": 0.0, "e": 0.0, "features": []}
                    run = trun = None
                elif line.startswith(b"; Z_HEIGHT:") and cur is not None:
                    try:
                        cur["z"] = _r(float(line.split(b":", 1)[1]))
                    except ValueError:
                        pass
                elif line.startswith((b"; printable_area =", b"; printable_height =")):
                    _plate(status, line)
                elif line.startswith(b"; FEATURE:"):
                    feature = line.split(b":", 1)[1].strip().decode("utf-8", "replace")[:40]
                    run = None
                    if cur is not None and feature and feature not in cur["features"]:
                        cur["features"].append(feature)
                continue
            code = line.split(b";", 1)[0].strip()
            head = code.split(None, 1)[0] if code else b""
            if head in (b"M82", b"M83"):
                rel = head == b"M83"
                if not rel:
                    status.update(state="unavailable", reason="The file uses absolute extrusion, so which moves print can't be read from it.")
                    return
                continue
            if head not in (b"G0", b"G1", b"G2", b"G3"):
                continue
            words = {k.decode(): float(v) for k, v in _WORD.findall(code)}
            if "F" in words:
                speed = _r(words["F"] / 60.0)
            nx, ny = words.get("X", x), words.get("Y", y)
            if cur is not None and (nx, ny) != (x, y):
                if rel and words.get("E", 0.0) > 0:
                    trun = None
                    if run is None or run[-2:] != [_r(x), _r(y)] or (cur["runs"] and cur["runs"][-1]["s"] != speed):
                        run = [_r(x), _r(y)]
                        cur["runs"].append({"f": feature, "s": speed, "p": run, "len": 0.0})
                    run.extend((_r(nx), _r(ny)))
                    seg = ((nx - x) ** 2 + (ny - y) ** 2) ** 0.5
                    cur["runs"][-1]["len"] += seg
                    cur["e"] += words["E"]
                    lo[0], lo[1] = min(lo[0], nx, x), min(lo[1], ny, y)
                    hi[0], hi[1] = max(hi[0], nx, x), max(hi[1], ny, y)
                else:
                    run = None
                    if trun is None or trun[-2:] != [_r(x), _r(y)]:
                        trun = [_r(x), _r(y)]
                        cur["travel"].append(trun)
                    trun.extend((_r(nx), _r(ny)))
                    cur["tlen"] += ((nx - x) ** 2 + (ny - y) ** 2) ** 0.5
            x, y = nx, ny
        else:
            flush()
            cur = None
        if cur is not None:
            flush()
    status["progress"] = 1.0
    if not layers:
        status.update(state="unavailable", reason="The sliced file has no layer markers to read.")
        return
    status["bounds"] = [_r(lo[0]), _r(lo[1]), _r(hi[0]), _r(hi[1])] if lo[0] < hi[0] or lo[1] < hi[1] else None
    status["e_filament"] = True


def _plate(status: dict, line: bytes) -> None:
    """The plate the slicer wrote into its own config lines: {area: [x0, y0, x1, y1], height}. Anything else isn't kept."""
    key, _, val = line[2:].decode("ascii", "ignore").partition("=")
    plate = status["plate"]
    try:
        if key.strip() == "printable_height":
            h = float(val)
            if 0 < h < 2000:
                plate["height"] = h
        else:
            pts = [tuple(float(c) for c in p.split("x")) for p in val.strip().split(",")]
            if len(pts) >= 3 and all(len(p) == 2 for p in pts):
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                if 0 < max(xs) - min(xs) < 2000 and 0 < max(ys) - min(ys) < 2000:
                    plate["area"] = [min(xs), min(ys), max(xs), max(ys)]
    except ValueError:
        pass


def _new(key: str) -> dict:
    return {"key": key, "state": "building", "progress": 0.0, "layers": [], "offsets": [], "bounds": None, "truncated": None,
            "reason": None, "e_filament": False, "plate": {}, "started": time.time()}


def _run(path: Path, side: Path, status: dict) -> None:
    with _lock:
        parse(path, side, status)


def request(job: dict) -> dict:
    """The layer state of a job, starting the one pass if there is none yet. Returns a public dict:
    {state: none|building|ready|unavailable|failed, progress, built, layers: [...], bounds, truncated, reason}."""
    path, side = quick.slice_path(job), _sidecar(job)
    if not path or not path.is_file() or not job.get("slice_sha256") or side is None:
        return {"state": "none", "reason": "There is no sliced file to read.", "layers": []}
    key = job["slice_sha256"]
    summary = _summary_path(side)
    with _guard:
        b = _builds.get(job["id"])
        if b and b["key"] != key:
            _builds.pop(job["id"], None)
            b = None
        if b is None and side.is_file() and summary.is_file():
            try:
                saved = json.loads(summary.read_text())
                if saved.get("v") == VERSION:
                    b = _new(key)
                    b.update(state="ready", progress=1.0, layers=saved["layers"], offsets=saved["offsets"],
                             bounds=saved["bounds"], truncated=saved["truncated"], e_filament=saved["e_filament"],
                             plate=saved.get("plate") or {})
                    _builds[job["id"]] = b
            except (OSError, ValueError, KeyError):
                b = None
        if b is None:
            b = _builds[job["id"]] = _new(key)
            threading.Thread(target=_run, args=(path, side, b), daemon=True, name=f"quick-layers-{job['id'][:6]}").start()
    return _public(b)


def _public(b: dict) -> dict:
    n = len(b["layers"])
    out = {"state": b["state"], "progress": round(b["progress"], 3) if b["state"] == "building" else None, "built": n,
           "layers": list(b["layers"]), "bounds": b["bounds"], "plate": b["plate"], "truncated": b["truncated"], "reason": b["reason"]}
    if b["state"] != "building":
        out["progress"] = 1.0 if b["state"] == "ready" else None
    return out


def layer(job: dict, n: int) -> dict | None:
    """The geometry of layer n, or None if it isn't read (yet)."""
    side = _sidecar(job)
    b = _builds.get(job["id"])
    if side is None or b is None or b["key"] != job.get("slice_sha256") or not (0 <= n < len(b["offsets"])):
        return None
    part = side if side.is_file() else side.with_name(side.name + ".part")
    try:
        with open(part, "rb") as f:
            f.seek(b["offsets"][n])
            data = f.readline(MAX_LINE * 8)
        return json.loads(data)
    except (OSError, ValueError):
        return None


def forget(job_id: str) -> None:
    with _guard:
        _builds.pop(job_id, None)


router = APIRouter(prefix="/api/quick")


def _job(job_id: str, request: Request) -> dict:
    quick._owner(request)
    try:
        return quick.get(job_id)
    except quick.QuickError as e:
        raise quick._http(e)


@router.get("/jobs/{job_id}/layers")
def layers_summary(job_id: str, request: Request):
    """Every layer's figures and the drawing bounds, as far as they are read; starts the one pass on first ask."""
    return JSONResponse(request_state(_job(job_id, request)), headers={"Cache-Control": "no-store"})


def request_state(job: dict) -> dict:
    if job["state"] not in ("sliced", "staging", "staged", "queued_in_bambuddy", "start_requested", "start_accepted",
                            "printing_confirmed", "outcome_uncertain", "finished"):
        return {"state": "none", "reason": "This job has no sliced file yet.", "layers": []}
    return request(job)


@router.get("/jobs/{job_id}/layers/{n}")
def layer_geometry(job_id: str, n: int, request: Request):
    job = _job(job_id, request)
    g = layer(job, n)
    if g is None:
        raise HTTPException(404, "That layer isn't read yet.")
    return JSONResponse(g, headers={"Cache-Control": "private, max-age=3600"})


@router.get("/jobs/{job_id}/model")
def model_file(job_id: str, request: Request):
    """The job's own STL, for the 3D view to draw (A19 P7). The Pi never reads the mesh; the browser does. A 3MF model, a
    removed file or a job without one is a plain 404 with the reason, and the 3D view then draws the toolpaths alone."""
    job = _job(job_id, request)
    p = quick.model_path(job)
    if p is None or p.suffix.lower() != ".stl" or not p.is_file():
        raise HTTPException(404, "The model isn't an STL file on the Pi, so only the toolpaths are drawn.")
    return FileResponse(p, media_type="model/stl", headers={"Cache-Control": "no-store"})
