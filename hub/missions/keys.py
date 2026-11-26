"""Per-source keys for the mission ledger (A35 §7.4; M1b plan decision 6). Each source posts with its own deploy key
(X-Hub-Deploy-Key), made by deploy/deploy-key.sh, whose SHA-256 the Pi keeps beside the release keys.

The map lives here, not in releases.KEY_FOR: KEY_FOR maps release *targets* to keys, so a mission key there could post
a release report for a target of the same name. A key here is a mistake guard between sources, not a trust boundary
(§5)."""
from .. import releases

KEYS = {"claude": "mission-claude", "importer": "mission-importer", "localai": "localai"}


def key_ok(request, source):
    """True only when `request` carries `source`'s own key; False for a source not on the list."""
    name = KEYS.get(source)
    return bool(name) and releases.host_key_ok(request, name)
