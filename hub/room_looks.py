"""Quick Looks for the Room view (amendment A20 D2, plan P2): three built-in looks and up to 8 the owner saves, each a
set of camera settings checked against room_camera's CONTROLS table. Stored in Pi Hub's database."""
from .room_camera import BY_KEY, Invalid, _check

LOOKS_KEY = "room_camera_looks"

# The three built-in looks (amendment A20 D2, plan decision 7).
BUILTIN_LOOKS = [
    {"name": "Night", "builtin": True,
     "values": {"ev": 1.5, "brightness": 0.1, "denoise": "hq", "metering": "average"}},
    {"name": "Bright", "builtin": True,
     "values": {"ev": -0.5, "contrast": 1.2}},
    {"name": "Bed close-up", "builtin": True,
     "values": {"zoom": 2.0, "centre_x": 50, "centre_y": 50, "ev": 0.5}},
]
BUILTIN_NAMES = frozenset(b["name"].lower() for b in BUILTIN_LOOKS)
CHIP_NAMES = frozenset(("auto", "save this look"))  # the looks row's own chips (A23 D5)
FORBIDDEN_LOOK_KEYS = frozenset(("turn", "mirror", "flip", "preset"))


def validate_look_name(name):
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 24:
        raise Invalid("name", "Look name must be 1 to 24 characters.")
    cleaned = name.strip()
    if any(ord(c) < 32 or ord(c) == 127 for c in cleaned):
        raise Invalid("name", "Look name cannot contain control characters.")
    if cleaned.lower() in BUILTIN_NAMES:
        raise Invalid("name", f"{cleaned!r} is a built-in look and cannot be modified.")
    if cleaned.lower() in CHIP_NAMES:
        raise Invalid("name", f"{cleaned!r} is already a button beside the looks. Choose another name.")
    return cleaned


def validate_look_values(values):
    if not isinstance(values, dict) or not values:
        raise Invalid(None, "Send at least one setting for a look.")
    for k in sorted(values):
        if k in FORBIDDEN_LOOK_KEYS:
            raise Invalid(k, f"{k!r} cannot be saved in a look.")
        if k not in BY_KEY:
            raise Invalid(k, f"There is no camera setting called {k!r}.")
        _check(BY_KEY[k], values[k])
    return {k: _check(BY_KEY[k], values[k]) for k in values}


def get_looks(store=None):
    from hub import auth
    custom = (store or auth).get(LOOKS_KEY, [])
    # Always built-ins first, then custom
    return [dict(b) for b in BUILTIN_LOOKS] + [dict(c) for c in custom]


def save_look(name, values, store=None):
    from hub import auth
    s = store or auth
    cleaned_name = validate_look_name(name)
    cleaned_values = validate_look_values(values)
    custom = s.get(LOOKS_KEY, [])
    for existing in custom:
        if existing["name"].lower() == cleaned_name.lower():
            raise Invalid("name", f"A look called {cleaned_name!r} already exists.")
    if len(custom) >= 8:
        raise Invalid(None, "You can save at most 8 custom looks.")
    look = {"name": cleaned_name, "values": cleaned_values}
    custom.append(look)
    s.put(LOOKS_KEY, custom)
    return look


def delete_look(name, store=None):
    from hub import auth
    s = store or auth
    if not isinstance(name, str):
        raise Invalid("name", "Look name required.")
    if name.strip().lower() in BUILTIN_NAMES:
        raise Invalid("name", "Built-in looks cannot be deleted.")
    custom = s.get(LOOKS_KEY, [])
    kept = [l for l in custom if l["name"].lower() != name.strip().lower()]
    if len(kept) == len(custom):
        raise Invalid("name", f"No look called {name!r} found.")
    s.put(LOOKS_KEY, kept)


