# Register Print Lab v2 extension routes before hub.app includes lab.router.
from . import lab as _lab  # noqa: F401
from . import lab_qualification as _lab_qualification  # noqa: F401
