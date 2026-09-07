#!/usr/bin/env python3
"""
Minecraft Castle-Builder Agent (fill-based, RCON via docker-exec rcon-cli).

Generates a list of `fill`/`setblock` commands that build a castle, then
a bash driver executes each through the container's rcon-cli (the only
RCON path proven reliable on this server), and verifies by reading blocks
back with `execute if block`.
"""
import sys

# Build site center (overworld)
CX, CZ = 60, 40
FOOT = 23
HALF = FOOT // 2          # 11
WALL_H = 7                # wall blocks above base
TOWER_H = 12              # tower height above base
X0, X1 = CX-HALF, CX+HALF   # 49 .. 71
Z0, Z1 = CZ-HALF, CZ+HALF   # 29 .. 51

COBBL="minecraft:cobblestone"; BRICK="minecraft:stone_bricks"
STONE="minecraft:stone"; GLASS="minecraft:glass"; BARS="minecraft:iron_bars"
AIR="minecraft:air"

def gen(G):
    """Return (cmds, verify) given base level G (surface block y)."""
    c=[]; v=[]
    def fill(x0,y0,z0,x1,y1,z1,b): c.append(f"fill {x0} {y0} {z0} {x1} {y1} {z1} {b}")
    def sb(x,y,z,b): c.append(f"setblock {x} {y} {z} {b}")
    def ck(x,y,z,b): v.append(f"execute if block {x} {y} {z} {b}")

    top = G + WALL_H          # top wall y
    # 1) solid base slab (on the surface)
    fill(X0,G,Z0,X1,G,Z1,BRICK);       ck(CX,G,CZ,BRICK)
    # 2) four walls (boxes, 1 thick)
    fill(X0,G+1,Z0,X1,top,Z0,COBBL);   ck(CX,G+1,Z0,COBBL)          # south
    fill(X0,G+1,Z1,X1,top,Z1,COBBL);   ck(CX,G+1,Z1,COBBL)          # north
    fill(X0,G+1,Z0,X0,top,Z1,COBBL);   ck(X0,G+1,CZ,COBBL)          # west
    fill(X1,G+1,Z0,X1,top,Z1,COBBL);   ck(X1,G+1,CZ,COBBL)          # east
    # 3) carve gate on south wall (center, width 3, height 3) + glass lintel
    fill(CX-1,G+1,Z0,CX+1,G+3,Z0,AIR)
    fill(CX-1,G+4,Z0,CX+1,G+5,Z0,GLASS); ck(CX,G+4,Z0,GLASS)
    # 4) windows (iron bars) on each wall at mid height
    wy = G+4
    for x in range(X0+3, X1-2, 4):
        if x==CX: continue
        sb(x,wy,Z0,BARS); sb(x,wy,Z1,BARS)
    for z in range(Z0+3, Z1-2, 4):
        if z==CZ: continue
        sb(X0,wy,z,BARS); sb(X1,wy,z,BARS)
    ck(X0+3,wy,Z0,BARS); ck(X1,wy,Z1-2,BARS)
    # 5) corner towers (3x3, taller, stone brick) + caps
    for (tx,tz) in [(X0,Z0),(X1,Z0),(X0,Z1),(X1,Z1)]:
        fill(tx-1,G,tz-1,tx+1,G+TOWER_H,tz+1,BRICK)
        fill(tx-2,G+TOWER_H+1,tz-2,tx+2,G+TOWER_H+1,tz+2,BRICK)   # 5x5 cap
    ck(X0,G+TOWER_H,Z0,BRICK); ck(X1,G+TOWER_H+1,Z1,BRICK)
    # 6) roof over inner keep
    ry = top+1
    fill(X0+3,ry,Z0+3,X1-3,ry,Z1-3,STONE); ck(CX,ry,CZ,STONE)
    return c, v

def detect_ground():
    """Probe surface level via rcon-cli. Returns G or None."""
    import subprocess
    def r(cmd):
        p=subprocess.run(["docker","exec","minecraft","rcon-cli","--host","127.0.0.1",
                          "--port","25575","--password","8d9afbc30c493401347b3d15",cmd],
                         capture_output=True,text=True,timeout=15)
        return p.stdout.strip()
    best=None
    for dx in (-2,0,2):
      for dz in (-2,0,2):
        x,z=CX+dx,CZ+dz
        for y in range(100,25,-1):
            if r(f"execute if block {x} {y} {z} minecraft:grass_block")=="Test passed":
                best = y if best is None else max(best,y); break
    if best is None:
        for y in range(100,25,-1):
            if r(f"execute if block {CX} {y} {CZ} minecraft:stone")=="Test passed":
                return y
    return best

if __name__=="__main__":
    import subprocess
    def r(cmd):
        p=subprocess.run(["docker","exec","minecraft","rcon-cli","--host","127.0.0.1",
                          "--port","25575","--password","8d9afbc30c493401347b3d15",cmd],
                         capture_output=True,text=True,timeout=15)
        return p.stdout.strip()
    # ensure region is force-loaded (persisted) so chunks exist
    r("forceload add 40 20 82 60")
    # detect surface: highest solid block in the center column (air above it)
    SOLID=["grass_block","dirt","podzol","coarse_dirt","stone","cobblestone",
           "sand","coarse_gravel","gravel","mud","sandstone","terracotta","mycelium"]
    G=None
    for y in range(120,30,-1):
        solid=False
        for b in SOLID:
            if r(f"execute if block {CX} {y} {CZ} minecraft:{b}")=="Test passed":
                solid=True; break
        if solid:
            # confirm air above
            if r(f"execute if block {CX} {y+1} {CZ} minecraft:air")!="Test failed":
                G=y; break
    if G is None: G=70
    c,v=gen(G)
    open("/data/minecraft-bot/cmds.txt","w").write("\n".join(c)+"\n")
    open("/data/minecraft-bot/verify.txt","w").write("\n".join(v)+"\n")
    open("/data/minecraft-bot/ground.txt","w").write(str(G)+"\n")
    print(f"ground G={G}; build commands={len(c)}; verify checks={len(v)}")
