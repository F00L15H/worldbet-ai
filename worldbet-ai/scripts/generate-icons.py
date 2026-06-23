"""Generate PWA PNG icons for WorldBet."""
from pathlib import Path
from PIL import Image, ImageDraw

ICONS_DIR = Path(__file__).resolve().parent.parent / 'icons'


def make(size: int, name: str) -> None:
    img = Image.new('RGB', (size, size), '#0d0f14')
    draw = ImageDraw.Draw(img)
    margin = size // 16
    draw.ellipse([margin, margin, size - margin, size - margin], outline='#00c853', width=max(2, size // 32))
    r = size // 10
    cx, cy = size // 2, size // 2
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill='#ffd700')
    img.save(ICONS_DIR / name)


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    make(192, 'icon-192.png')
    make(512, 'icon-512.png')
    make(180, 'apple-touch-icon.png')
    print('PWA icons generated in', ICONS_DIR)


if __name__ == '__main__':
    main()
