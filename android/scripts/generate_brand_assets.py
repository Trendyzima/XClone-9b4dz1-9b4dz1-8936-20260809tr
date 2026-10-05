#!/usr/bin/env python3
"""Generate Testagram Android brand assets from the supplied Testagram icon."""
import os, shutil, subprocess

ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),"../app/src/main/res"))
SOURCE=os.path.abspath(os.path.join(os.path.dirname(__file__),"../branding/testagram-icon.webp"))
MAGICK=shutil.which("magick") or shutil.which("convert")
if not MAGICK:
    raise SystemExit("ImageMagick is required to generate the branded Android PNG assets.")

def run(*args):
    subprocess.run([MAGICK,*args],check=True)

os.makedirs(os.path.join(ROOT,"drawable-nodpi"),exist_ok=True)

# Supplied icon, preserved and rasterized for every Android launcher density.
for density,size in (("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)):
    out=os.path.join(ROOT,f"mipmap-{density}")
    os.makedirs(out,exist_ok=True)
    for name in ("ic_launcher.png","ic_launcher_round.png"):
        run(SOURCE,"-resize",f"{size}x{size}!","-depth","8","-strip","PNG24:"+os.path.join(out,name))

# Adaptive icon foreground: same supplied artwork, centered inside the safe zone.
run(SOURCE,"-resize","90x90!","-background","none","-gravity","center","-extent","108x108",
    "-depth","8","-strip", "PNG32:"+os.path.join(ROOT,"drawable-nodpi","ic_launcher_foreground_bitmap.png"))

# Three slower, polished portrait splash screens. SplashActivity holds each for 1.6s.
screens=[
    ("WELCOME TO","Your people. Your stories. Your world."),
    ("DISCOVER MORE","Fresh posts, live moments and conversations."),
    ("YOUR WORLD, LIVE","Discover. Share. Connect. Stay close."),
]
for i,(title,subtitle) in enumerate(screens,1):
    out=os.path.join(ROOT,"drawable-nodpi",f"splash_{i}.png")
    run("-size","540x960","gradient:#062d18-#20bd58",
        "(",SOURCE,"-resize","250x250!","-geometry","+0+90",")",
        "-gravity","north","-composite",
        "-font","DejaVu-Sans-Bold","-pointsize","30","-fill","#ffffff",
        "-annotate","+0+390",title,
        "-font","DejaVu-Sans","-pointsize","19","-fill","#e6fff0",
        "-annotate","+0+440",subtitle,
        "-font","DejaVu-Sans-Bold","-pointsize","15","-fill","#ffffff",
        "-annotate","+0+505",f"TESTAGRAM  •  0{i}/3",
        "-font","DejaVu-Sans","-pointsize","15","-fill","#d8f7e2",
        "-annotate","+0+850","Made for moments that matter.",
        "-depth","8","-strip","PNG24:"+out)

# Legacy drawable follows the first branded splash.
shutil.copy2(os.path.join(ROOT,"drawable-nodpi","splash_1.png"),
             os.path.join(ROOT,"drawable","splash.png"))
