#!/usr/bin/env python3
"""Generate Testagram Android brand PNGs without third-party packages."""
import os, struct, zlib
GREEN=(34,197,94); LIGHT=(245,250,247); DARK=(12,25,18); MUTED=(74,90,80); PALE=(190,210,198); WHITE=(255,255,255)
FONT={"A":["01110","10001","10001","11111","10001","10001","10001"],"B":["11110","10001","10001","11110","10001","10001","11110"],"C":["01111","10000","10000","10000","10000","10000","01111"],"D":["11110","10001","10001","10001","10001","10001","11110"],"E":["11111","10000","10000","11110","10000","10000","11111"],"F":["11111","10000","10000","11110","10000","10000","10000"],"G":["01111","10000","10000","10111","10001","10001","01111"],"H":["10001","10001","10001","11111","10001","10001","10001"],"I":["11111","00100","00100","00100","00100","00100","11111"],"J":["00111","00010","00010","00010","10010","10010","01100"],"K":["10001","10010","10100","11000","10100","10010","10001"],"L":["10000","10000","10000","10000","10000","10000","11111"],"M":["10001","11011","10101","10101","10001","10001","10001"],"N":["10001","11001","10101","10011","10001","10001","10001"],"O":["01110","10001","10001","10001","10001","10001","01110"],"P":["11110","10001","10001","11110","10000","10000","10000"],"Q":["01110","10001","10001","10001","10101","10010","01101"],"R":["11110","10001","10001","11110","10100","10010","10001"],"S":["01111","10000","10000","01110","00001","00001","11110"],"T":["11111","00100","00100","00100","00100","00100","00100"],"U":["10001","10001","10001","10001","10001","10001","01110"],"V":["10001","10001","10001","10001","10001","01010","00100"],"W":["10001","10001","10001","10101","10101","11011","10001"],"X":["10001","10001","01010","00100","01010","10001","10001"],"Y":["10001","10001","01010","00100","00100","00100","00100"],"Z":["11111","00001","00010","00100","01000","10000","11111"],"0":["01110","10001","10011","10101","11001","10001","01110"],"1":["00100","01100","00100","00100","00100","00100","01110"],"2":["01110","10001","00001","00010","00100","01000","11111"],"3":["11110","00001","00001","01110","00001","00001","11110"],"4":["00010","00110","01010","10010","11111","00010","00010"],"5":["11111","10000","10000","11110","00001","00001","11110"],"6":["01110","10000","10000","11110","10001","10001","01110"],"7":["11111","00001","00010","00100","01000","01000","01000"],"8":["01110","10001","10001","01110","10001","10001","01110"],"9":["01110","10001","10001","01111","00001","00001","01110"]," ":["000","000","000","000","000","000","000"],".":["000","000","000","000","000","000","001"],",":["000","000","000","000","000","001","010"],"-":["00000","00000","00000","11111","00000","00000","00000"]}
def png(path,w,h,pix):
    raw=bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w): raw.extend(bytes(pix[y*w+x]))
    def chunk(t,d): return struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d)&0xffffffff)
    data=b"\x89PNG\r\n\x1a\n"+chunk(b'IHDR',struct.pack(">IIBBBBB",w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(raw),9))+chunk(b'IEND',b'')
    open(path,"wb").write(data)
def rect(p,w,h,x0,y0,x1,y1,c):
    for y in range(max(0,int(y0)),min(h,int(y1))):
        for x in range(max(0,int(x0)),min(w,int(x1))): p[y*w+x]=c
def circle(p,w,h,cx,cy,r,c):
    rr=r*r
    for y in range(max(0,cy-r),min(h,cy+r+1)):
        for x in range(max(0,cx-r),min(w,cx+r+1)):
            if (x-cx)*(x-cx)+(y-cy)*(y-cy)<=rr:p[y*w+x]=c
def text(p,w,h,s,x,y,scale,c,spacing=1):
    for ch in s.upper():
        g=FONT.get(ch,FONT[" "])
        for gy,row in enumerate(g):
            for gx,v in enumerate(row):
                if v=="1":
                    for sy in range(scale):
                        for sx in range(scale):
                            xx=x+gx*scale+sx; yy=y+gy*scale+sy
                            if 0<=xx<w and 0<=yy<h:p[yy*w+xx]=c
        x+=(len(g[0])+spacing)*scale
def centered(p,w,h,s,y,scale,c):
    width=sum((len(FONT.get(ch,FONT[" "])[0])+1)*scale for ch in s.upper())-scale
    text(p,w,h,s,(w-width)//2,y,scale,c)
def mark(p,w,h,cx,cy,scale):
    rect(p,w,h,cx-50*scale,cy-7*scale,cx+50*scale,cy+7*scale,WHITE)
    rect(p,w,h,cx-9*scale,cy,cx+9*scale,cy+42*scale,WHITE)
    circle(p,w,h,cx-41*scale,cy,7*scale,WHITE); circle(p,w,h,cx+41*scale,cy,7*scale,WHITE)
    circle(p,w,h,cx-9*scale,cy+42*scale,9*scale,WHITE); circle(p,w,h,cx+9*scale,cy+42*scale,9*scale,WHITE)
def make_splash(path,stage):
    w,h=540,960; p=[LIGHT]*(w*h)
    rect(p,w,h,60,70,480,350,GREEN); mark(p,w,h,270,185,2)
    titles=[("WELCOME TO","TESTAGRAM"),("KEEP","DISCOVERING"),("READY WHEN","YOU ARE")]
    lines=[["YOUR PEOPLE. YOUR STORIES. YOUR WORLD."],["FRESH POSTS, VIDEOS AND LIVE MOMENTS."],["YOUR FEED AND SAVED MEDIA CAN STAY","WITH YOU OFFLINE."]][stage-1]
    a,b=titles[stage-1]; centered(p,w,h,a,445,5,DARK); centered(p,w,h,b,500,5,DARK)
    yy=590
    for line in lines: centered(p,w,h,line,yy,2,MUTED); yy+=26
    for i in range(3): circle(p,w,h,245+i*25,790,5,GREEN if i==stage-1 else PALE)
    centered(p,w,h,"TESTAGRAM",845,3,MUTED); png(path,w,h,p)
def make_icon(path,size):
    p=[GREEN]*(size*size); mark(p,size,size,size//2,int(size*.43),max(1,size//108)); png(path,size,size,p)
def main():
    root=os.path.join(os.path.dirname(__file__),"../app/src/main/res")
    os.makedirs(os.path.join(root,"drawable-nodpi"),exist_ok=True)
    for i in range(1,4): make_splash(os.path.join(root,"drawable-nodpi",f"splash_{i}.png"),i)
    for name,size in [("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)]:
        for prefix in ("ic_launcher","ic_launcher_round"):
            d=os.path.join(root,f"mipmap-{name}"); os.makedirs(d,exist_ok=True); make_icon(os.path.join(d,f"{prefix}.png"),size)
if __name__=="__main__": main()
