"""A19 Q5 on the Pi: a sliced file without the X2D start sequence is refused, even when the Mac says it is fine.

A zip read, never a slice. The same rules as print-lab's `lab/quick/start_check.py` (the Mac checks first, so a bug there
alone can't publish a bad file): the start block's command sequence against a reference taken from a known-good build, its
line count, the printer's start G-code hash and the filament ids. The reference is a copy of print-lab's
`presets/quick/x2d-start-reference.json`; until a sync step owns it (P9), a change there is mirrored here by hand."""
import hashlib
import json
import re
import zipfile
from pathlib import Path

REFERENCE = Path(__file__).with_name("quick_start_reference.json")
MAX_GCODE = 1024 ** 3  # unpacked G-code the check will read; a bigger plate is not a Quick Print
START, END = b"; EXECUTABLE_BLOCK_START", b"; MACHINE_START_GCODE_END"


def load_reference(path: Path | None = None) -> dict:
    ref = json.loads(Path(path or REFERENCE).read_text())
    if not ref.get("commands") or not ref.get("machine_start_sha256"):
        raise ValueError("The start reference is incomplete")
    return ref


def _missing(want: list[str], have: list[str]) -> list[str]:
    it = iter(have)
    return [c for c in want if c not in it]


MAX_LINE = 1 << 20  # no single G-code line, however it is built, is held past this
READ = 1 << 16


def _lines(f):
    """Lines of a binary stream read in fixed pieces. Yields (line, too_long): a line past MAX_LINE is skipped, never kept."""
    tail, skipping = b"", False
    while chunk := f.read(READ):
        parts = (tail + chunk).split(b"\n")
        tail = parts.pop()
        for ln in parts:
            yield (b"", True) if skipping or len(ln) > MAX_LINE else (ln, False)
            skipping = False
        if len(tail) > MAX_LINE:
            tail, skipping = b"", True
    if tail or skipping:
        yield (b"", True) if skipping or len(tail) > MAX_LINE else (tail, False)


def check_artifact(path: Path, reference: dict, plate: int = 1) -> tuple[bool, list[str], int]:
    """(ok, reasons, start block lines) for a sliced .gcode.3mf. Streams the G-code, keeping only the start block and the
    two header lines it needs, so a large plate costs time but not memory. Refuses what could make the checker and
    Studio disagree about which G-code is the plate's: duplicate entry names, any other plate's G-code, a line of code
    before the start block, an over-long line, or a start block far longer than the reference's."""
    reasons: list[str] = []
    block: list[str] = []
    inside = seen_end = False
    machine = ids = None
    total = 0
    limit = max(2000, 5 * int(reference.get("block_lines", 0)))
    name = f"Metadata/plate_{plate}.gcode"
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            if len(names) != len(set(names)):
                return False, ["The archive has duplicate entry names"], 0
            others = [n for n in names if re.fullmatch(r"Metadata/plate_\d+\.gcode", n) and n != name]
            if others:
                return False, ["The archive holds more than one plate's G-code"], 0
            with z.open(name) as f:
                for raw, too_long in _lines(f):
                    total += len(raw) + 1
                    if total > MAX_GCODE:
                        return False, [f"The G-code is larger than {MAX_GCODE >> 20} MiB"], 0
                    if too_long:
                        return False, ["The G-code has a line longer than 1 MiB"], 0
                    line = raw.strip()
                    if not inside and not seen_end:
                        if line.startswith(START):
                            inside = True
                        elif line and not line.startswith(b";"):
                            return False, ["G-code runs before the start block"], 0
                    if inside:
                        if line.startswith(END):
                            inside, seen_end = False, True
                        else:
                            block.append(line.decode("utf-8", "replace"))
                            if len(block) > limit:
                                return False, [f"The start block is longer than {limit} lines"], len(block)
                    elif line.startswith(b"; machine_start_gcode = "):
                        machine = line[len(b"; machine_start_gcode = "):].decode("utf-8", "replace").strip()
                    elif line.startswith(b"; filament_ids = "):
                        ids = line[len(b"; filament_ids = "):].decode("utf-8", "replace").strip()
    except (zipfile.BadZipFile, KeyError, OSError, EOFError):
        return False, ["The file isn't a sliced 3MF with a G-code plate"], 0
    if not seen_end or not block:
        return False, ["The G-code has no start block"], 0
    seq: list[str] = []
    for ln in block:
        code = ln.split(";", 1)[0].strip()
        if code and (not seq or seq[-1] != code.split()[0]):
            seq.append(code.split()[0])
    lines = len(block)
    missing = _missing(reference["commands"], seq)
    if missing:
        reasons.append(f"Start block is missing {len(missing)} of {len(reference['commands'])} commands the X2D start "
                       f"sequence has, starting with {', '.join(missing[:6])}")
    if lines < reference.get("block_lines", 0) * 0.9:
        reasons.append(f"Start block has {lines} lines against {reference['block_lines']} in the known-good file")
    if machine is None or hashlib.sha256(machine.encode()).hexdigest() != reference["machine_start_sha256"]:
        reasons.append("The printer's start G-code isn't the known-good one")
    if not ids or not ids.strip('";'):
        reasons.append("The project has no filament ids")
    return not reasons, reasons, lines
