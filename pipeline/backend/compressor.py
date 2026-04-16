"""
Compressor — réduit les images avant envoi à l'API Vision.
Max 1280×960 px, JPEG qualité 80, retourne bytes en mémoire.
Ne touche pas au fichier source.
"""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

MAX_WIDTH = 1280
MAX_HEIGHT = 960
JPEG_QUALITY = 80


def compress(source: Path | bytes) -> bytes:
    """
    Charge une image (fichier ou bytes), la redimensionne si nécessaire
    à max 1280×960 (ratio conservé), retourne des bytes JPEG qualité 80.
    Les petites images ne sont PAS agrandies.
    """
    if isinstance(source, (str, Path)):
        img = Image.open(Path(source))
    else:
        img = Image.open(io.BytesIO(source))

    # EXIF orientation
    try:
        from PIL import ImageOps
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    elif img.mode == "L":
        img = img.convert("RGB")

    # thumbnail() ne réduit que si l'image dépasse les limites
    img = img.copy()
    img.thumbnail((MAX_WIDTH, MAX_HEIGHT), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue()


def compress_many(sources: list[Path | bytes]) -> list[bytes]:
    """Compresse une liste d'images et retourne une liste de bytes JPEG."""
    return [compress(s) for s in sources]
