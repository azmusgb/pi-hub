"""Guest Wi-Fi: the network details the owner saves, and a QR code phones can scan to join."""
import io

from . import auth

SECURITY = {"WPA": "WPA/WPA2/WPA3", "WEP": "WEP", "nopass": "No password"}


def _escape(s):
    return "".join("\\" + ch if ch in '\\;,:"' else ch for ch in s)


def details():
    return auth.get("wifi")


def save(ssid, password, security="WPA"):
    ssid = (ssid or "").strip()
    if not 1 <= len(ssid) <= 32:
        raise ValueError("The network name needs 1 to 32 characters.")
    if security not in SECURITY:
        raise ValueError("Choose the network's security type.")
    if security != "nopass" and not 8 <= len(password or "") <= 63:
        raise ValueError("A Wi-Fi password has 8 to 63 characters.")
    auth.put("wifi", {"ssid": ssid, "password": password if security != "nopass" else "", "security": security})


def clear():
    auth.put("wifi", None)


def qr_svg():
    w = details()
    if not w:
        return None
    import qrcode
    import qrcode.image.svg
    text = f"WIFI:T:{w['security']};S:{_escape(w['ssid'])};P:{_escape(w['password'])};;"
    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue()
