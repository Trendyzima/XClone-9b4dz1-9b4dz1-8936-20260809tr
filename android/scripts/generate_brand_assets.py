#!/usr/bin/env python3
"""Generate Testagram Android brand assets from the supplied Testagram icon."""
import os, shutil, subprocess

ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),"../app/src/main/res"))
SOURCE=os.path.abspath(os.path.join(os.path.dirname(__file__),"../branding/testagram-icon.webp"))
FFMPEG=shutil.which("ffmpeg") or os.path.abspath(os.path.join(os.path.dirname(__file__),"../../node_modules/ffmpeg-static/ffmpeg"))
if not os.path.isfile(FFMPEG):
    raise SystemExit("ffmpeg is required to generate the branded Android PNG assets.")

def run(*args):
    subprocess.run([FFMPEG,"-hide_banner","-loglevel","error","-y",*args],check=True)

os.makedirs(os.path.join(ROOT,"drawable-nodpi"),exist_ok=True)

# Supplied Testagram artwork, preserved and rasterized for each Android launcher density.
for density,size in (("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)):
    out=os.path.join(ROOT,f"mipmap-{density}")
    os.makedirs(out,exist_ok=True)
    for name in ("ic_launcher.png","ic_launcher_round.png"):
        run("-i",SOURCE,"-vf",f"scale={size}:{size}","-frames:v","1","-pix_fmt","rgb24",os.path.join(out,name))

# Adaptive foreground: same supplied artwork, centered in the Android safe zone.
run("-i",SOURCE,"-vf","scale=90:90,format=rgba,pad=108:108:9:9:color=black@0",
    "-frames:v","1","-pix_fmt","rgba",
    os.path.join(ROOT,"drawable-nodpi","ic_launcher_foreground_bitmap.png"))

screen_designs=[
    ("0x062d18",250,120,[
        "drawbox=x=40:y=40:w=460:h=4:color=white@0.85:t=fill",
        "drawbox=x=40:y=916:w=460:h=4:color=white@0.55:t=fill",
        "drawbox=x=60:y=520:w=420:h=8:color=0x9df2bb@0.75:t=fill",
    ]),
    ("0x0b6b32",220,155,[
        "drawbox=x=48:y=70:w=4:h=820:color=white@0.32:t=fill",
        "drawbox=x=488:y=70:w=4:h=820:color=white@0.32:t=fill",
        "drawbox=x=80:y=555:w=380:h=10:color=white@0.82:t=fill",
        "drawbox=x=120:y=590:w=90:h=8:color=0x9df2bb@0.85:t=fill",
        "drawbox=x=225:y=590:w=90:h=8:color=0x9df2bb@0.55:t=fill",
        "drawbox=x=330:y=590:w=90:h=8:color=0x9df2bb@0.35:t=fill",
    ]),
    ("0x041f12",280,100,[
        "drawbox=x=32:y=32:w=476:h=6:color=0x8cf2aa@0.8:t=fill",
        "drawbox=x=32:y=922:w=476:h=6:color=white@0.35:t=fill",
        "drawbox=x=70:y=535:w=120:h=12:color=white@0.85:t=fill",
        "drawbox=x=210:y=535:w=120:h=12:color=0x9df2bb@0.6:t=fill",
        "drawbox=x=350:y=535:w=120:h=12:color=0x9df2bb@0.3:t=fill",
        "drawbox=x=90:y=580:w=360:h=4:color=white@0.22:t=fill",
    ]),
]
for i,(background,size,y,decor) in enumerate(screen_designs,1):
    out=os.path.join(ROOT,"drawable-nodpi",f"splash_{i}.png")
    graph=f"[1:v]scale={size}:{size}[icon];[0:v][icon]overlay=(W-w)/2:{y}," + ",".join(decor)
    run("-f","lavfi","-i",f"color=c={background}:s=540x960:r=1","-i",SOURCE,
        "-filter_complex",graph,"-frames:v","1","-pix_fmt","rgb24",out)

# Legacy drawable follows the first branded splash.
import shutil
shutil.copy2(os.path.join(ROOT,"drawable-nodpi","splash_1.png"),
             os.path.join(ROOT,"drawable","splash.png"))
