#!/usr/bin/env python3
"""Generate Testagram Android brand assets from the supplied Testagram icon."""
import os, shutil, subprocess

ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),"../app/src/main/res"))
SOURCE=os.path.abspath(os.path.join(os.path.dirname(__file__),"../branding/testagram-icon.webp"))
FFMPEG=shutil.which("ffmpeg")
if not FFMPEG:
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

font_bold="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
font_regular="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
screens=[
    ("WELCOME TO","Your people. Your stories. Your world."),
    ("DISCOVER MORE","Fresh posts, live moments and conversations."),
    ("YOUR WORLD, LIVE","Discover. Share. Connect. Stay close."),
]
for i,(title,subtitle) in enumerate(screens,1):
    out=os.path.join(ROOT,"drawable-nodpi",f"splash_{i}.png")
    graph=(
        "[1:v]scale=250:250[icon];"
        "[0:v][icon]overlay=(W-w)/2:90,"
        "drawbox=x=40:y=40:w=460:h=880:color=0x20d866@0.12:t=fill,"
        f"drawtext=fontfile={font_bold}:text='{title}':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=390,"
        f"drawtext=fontfile={font_regular}:text='{subtitle}':fontcolor=0xe6fff0:fontsize=19:x=(w-text_w)/2:y=440,"
        f"drawtext=fontfile={font_bold}:text='TESTAGRAM  •  0{i}/3':fontcolor=white:fontsize=15:x=(w-text_w)/2:y=505,"
        f"drawtext=fontfile={font_regular}:text='Made for moments that matter.':fontcolor=0xd8f7e2:fontsize=15:x=(w-text_w)/2:y=850"
    )
    run("-f","lavfi","-i","color=c=0x062d18:s=540x960:r=1","-i",SOURCE,
        "-filter_complex",graph,"-frames:v","1","-pix_fmt","rgb24",out)

# Legacy drawable follows the first branded splash.
import shutil
shutil.copy2(os.path.join(ROOT,"drawable-nodpi","splash_1.png"),
             os.path.join(ROOT,"drawable","splash.png"))
