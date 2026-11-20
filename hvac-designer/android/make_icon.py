"""יוצר אייקון אפליקציה: פתית שלג (קירור) על רקע כחול-קרח, בגדלים לכל צפיפויות המסך."""
import math, os, sys
from PIL import Image, ImageDraw

def draw(size):
    S = size * 4  # ציור בהגדלה ואז הקטנה לקבלת קצוות חלקים
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=(15, 127, 168, 255))
    cx = cy = S / 2
    R = S * 0.32
    w = max(2, int(S * 0.055))
    white = (255, 255, 255, 255)
    for k in range(6):
        a = math.radians(90 + k * 60)
        x2, y2 = cx + R * math.cos(a), cy - R * math.sin(a)
        d.line([cx, cy, x2, y2], fill=white, width=w)
        for t in (0.55, 0.8):  # זרועות צדדיות
            px, py = cx + R * t * math.cos(a), cy - R * t * math.sin(a)
            for s in (-1, 1):
                b = a + s * math.radians(40)
                L = R * (0.32 if t < 0.7 else 0.2)
                d.line([px, py, px + L * math.cos(b), py - L * math.sin(b)], fill=white, width=w)
    r = S * 0.07
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(181, 98, 45, 255))  # מרכז נחושת
    return im.resize((size, size), Image.LANCZOS)

out = sys.argv[1]
for name, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    p = os.path.join(out, "mipmap-" + name)
    os.makedirs(p, exist_ok=True)
    draw(px).save(os.path.join(p, "ic_launcher.png"))
