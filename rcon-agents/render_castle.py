#!/usr/bin/env python3
"""Render the castle from its verified build commands (cmds.txt + cmds2.txt)
as an isometric image using only the block data we actually placed in-world."""
import re
from PIL import Image, ImageDraw

TILE_W = 22          # iso tile width
TILE_H = 11         # iso tile height (half)
Y_STEP = 15         # vertical px per block-height

COLORS = {
 "stone_bricks": (106,106,106),
 "cobblestone":  (128,128,128),
 "stone":        (168,168,168),
 "grass_block":  (104,168,74),
 "dirt":         (134,96,67),
 "podzol":       (120,110,80),
 "glass":        (196,232,246),
 "iron_bars":    (190,190,190),
 "air":          None,
}
def mat_color(name):
    key = name.split(":")[-1]
    return COLORS.get(key, (150,120,90))

cubes = {}   # (x,y,z) -> color
for f in ("/data/minecraft-bot/cmds.txt","/data/minecraft-bot/cmds2.txt"):
    for line in open(f):
        line=line.strip()
        if not line: continue
        if line.startswith("fill "):
            p=line.split()
            x0,y0,z0,x1,y1,z1,b = int(p[1]),int(p[2]),int(p[3]),int(p[4]),int(p[5]),int(p[6]),p[7]
            col=mat_color(b)
            if col is None: 
                # air fill: remove any existing
                for x in range(x0,x1+1):
                    for y in range(y0,y1+1):
                        for z in range(z0,z1+1):
                            cubes.pop((x,y,z),None)
                continue
            for x in range(x0,x1+1):
                for y in range(y0,y1+1):
                    for z in range(z0,z1+1):
                        cubes[(x,y,z)]=col
        elif line.startswith("setblock "):
            p=line.split()
            col=mat_color(p[3])
            if col is None: cubes.pop((int(p[1]),int(p[2]),int(p[3])),None)
            else: cubes[(int(p[1]),int(p[2]),int(p[3]))]=col

print(f"solid blocks: {len(cubes)}")
xs=[c[0] for c in cubes]; ys=[c[1] for c in cubes]; zs=[c[2] for c in cubes]
minx,maxx,miny,maxy,minz,maxz=min(xs),max(xs),min(ys),max(ys),min(zs),max(zs)
print(f"x {minx}-{maxx} y {miny}-{maxy} z {minz}-{maxz}")

# ground base level = miny-1 (so blocks sit on it)
gy = miny-1

def sx(x,z): return (x-minx)-(z-minz)
def sy(x,y,z): return (x-minx)+(z-minz) - (y-gy)   # iso coord (units)

# image size from projected extent
px=[sx(x,z) for x,z in zip(xs,zs)]
py=[sx(x,z)+sy(x,y,z) for x,y,z in zip(xs,ys,zs)]
W = int((max(px)-min(px)+4)*TILE_W)+80
H = int((max(py)-min(py)+5)*(TILE_H))+80

def to_px(x,y,z):
    # center the image: find bounding box of projected points then offset
    ix = sx(x,z); iy = sy(x,y,z)
    return (ix*TILE_W, iy*(TILE_H))

img=Image.new("RGB",(W,H),(24,32,48))
d=ImageDraw.Draw(img)

# ground platform (a flat grass slab under everything at y=gy)
gx0,gz0 = minx-2,minz-2
gx1,gz1 = maxx+2,maxz+2
# draw ground as a grid of tiles
for gx in range(gx0,gx1+1):
    for gz in range(gz0,gz1+1):
        x,y,z=gx,gy,gz
        ix,sx0 = sx(gx,gz), sx(gx,gz)
        # top face corners (units)
        c00=(sx(gx,gz)*TILE_W, sy(gx,gy,gz)*TILE_H)
        c10=(sx(gx+1,gz)*TILE_W, sy(gx+1,gy,gz)*TILE_H)
        c11=(sx(gx+1,gz+1)*TILE_W, sy(gx+1,gy,gz+1)*TILE_H)
        c01=(sx(gx,gz+1)*TILE_W, sy(gx,gy,gz+1)*TILE_H)
        d.polygon([c00,c10,c11,c01], fill=(96,140,66) if (gx+gz)%2==0 else (88,130,60), outline=(60,90,40))

# offset everything to center: compute min/max px
def poly_pts(x,y,z):
    def P(dx,dy,dz): return (sx(x+dx,z+dz)*TILE_W, sy(x+dx,y+dy,z+dz)*TILE_H)
    A,B,C,D=P(0,0,0),P(1,0,0),P(1,0,1),P(0,0,1)      # top corners
    # left face (z+ side), right face (x+ side), each dropped Y_STEP
    def drop(pt): return (pt[0],pt[1]+Y_STEP)
    top=[A,B,C,D]
    left=[D,C,drop(C),drop(D)]
    right=[B,C,drop(C),drop(B)]
    return top,left,right

def shade(c,f): return tuple(max(0,min(255,int(v*f))) for v in c)

# painter order: far (small x+z) first, low y first, then near
order=sorted(cubes.keys(), key=lambda c:(c[0]+c[2], c[1]))
for (x,y,z) in order:
    col=cubes[(x,y,z)]
    top,left,right=poly_pts(x,y,z)
    # hide faces that are occluded (covered by a neighbor) for speed & cleanliness
    d.polygon(left, fill=shade(col,0.72), outline=(20,20,20))
    d.polygon(right, fill=shade(col,0.85), outline=(20,20,20))
    d.polygon(top, fill=col, outline=(30,30,30))

# crop to content
bbox=img.getbbox()
if bbox: img=img.crop((max(0,bbox[0]-8),max(0,bbox[1]-8),min(W,bbox[2]+8),min(H,bbox[3]+8)))
img.save("/data/minecraft-bot/castle.png")
print("saved", img.size)
