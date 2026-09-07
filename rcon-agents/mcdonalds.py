#!/usr/bin/env python3
"""McDonalds-builder — transport via `docker exec minecraft rcon-cli` (proven, version-agnostic)."""
import subprocess, sys, time

CX, CZ = 115, 40
RED="minecraft:red_concrete"; WHITE="minecraft:white_concrete"; YEL="minecraft:yellow_concrete"
LGRAY="minecraft:light_gray_concrete"; DARK="minecraft:dark_concrete"; BLK="minecraft:black_concrete"
GLASS="minecraft:glass"; SMOOTH="minecraft:smooth_stone"; AIR="minecraft:air"

class Rcon:
    def __init__(s, pw): s.pw=pw
    def _run(s, c):
        p=subprocess.run(["docker","exec","minecraft","rcon-cli","--host","127.0.0.1","--port","25575","--password",s.pw,c], capture_output=True, text=True)
        return (p.stdout or p.stderr or "").strip()
    def cmd(s,c): return s._run(c)
    def ok(s,c): return s._run(c) in ("","Test passed")

def detect_ground(r,cx,cz):
    """Fast: narrow Y band around known flat-plain (~y100), few points."""
    best=None
    for x,z in ((cx,cz),(cx-3,cz),(cx,cz-3)):
        for y in range(112,86,-1):
            hit=False
            for blk in ("grass_block","dirt","stone","sand","light_gray_concrete"):
                if r.ok(f"execute if block {x} {y} {z} minecraft:{blk}"):
                    if best is None or y>best: best=y
                    hit=True; break
            if hit: break
    return best

def main():
    pw=sys.argv[1]
    r=Rcon(pw)
    print("[*] transport=docker-exec rcon-cli; connected")
    r.cmd("forceload add 95 25 135 55"); time.sleep(1.5)
    G=detect_ground(r,CX,CZ)
    if G is None: G=100
    print(f"[*] ground level = {G}; building McDonalds at {CX},{CZ}")
    placed=0
    def sb(x,y,z,b):
        nonlocal placed; r.cmd(f"setblock {x} {y} {z} {b}"); placed+=1
    def fl(x1,y1,z1,x2,y2,z2,b):
        nonlocal placed; r.cmd(f"fill {x1} {y1} {z1} {x2} {y2} {z2} {b}"); placed+=1
    fl(100,G,30,130,G,50,LGRAY)                                  # parking pad
    fl(107,G+1,36,122,G+4,36,RED)                                # S wall
    fl(107,G+1,43,122,G+4,43,RED)                                # N wall
    fl(122,G+1,36,122,G+4,43,RED)                                # E wall
    fl(107,G+1,36,107,G+4,43,RED)                                # W wall
    fl(106,G+5,35,123,G+5,44,WHITE)                              # roof
    for x in list(range(108,114))+list(range(117,122)):          # front glass
        sb(x,G+2,36,GLASS); sb(x,G+3,36,GLASS)
    for x in (114,115):                                          # door
        for h in (G+1,G+2,G+3): sb(x,h,36,AIR)
    sb(112,G+1,34,SMOOTH); sb(118,G+1,34,SMOOTH)                 # M poles
    for ci,cc in enumerate(range(7)):                            # golden M
        for yy in range(G+2,G+7):
            rel=yy-(G+2)
            if rel==0: sb(112+cc,yy,34,YEL)
            elif ci in (0,1,5,6): sb(112+cc,yy,34,YEL)
            elif ci in (3,4) and rel in (1,2,3): sb(112+cc,yy,34,YEL)
    fl(124,G,34,129,G,46,DARK)                                   # drive-thru lane
    for h in range(G+1,G+4): sb(127,h,40,BLK)                    # menu board
    sb(127,G+4,40,LGRAY)
    for x in (126,128): sb(x,G+4,40,YEL)
    sb(127,G+5,40,YEL)
    sb(125,G+1,44,LGRAY); sb(125,G+2,44,RED)                     # speaker pole
    checks=[(115,G,40,LGRAY),(115,G+1,36,RED),(107,G+4,43,RED),(115,G+5,40,WHITE),
            (110,G+3,36,GLASS),(114,G+2,36,AIR),(115,G+2,34,YEL),(112,G+6,34,YEL),(127,G+4,40,LGRAY)]
    good=bad=0
    for (x,y,z,b) in checks:
        if r.ok(f"execute if block {x} {y} {z} {b}"): good+=1
        else: bad+=1; print(f"  [VERIFY FAIL] {x} {y} {z} expected {b}")
    r.cmd("forceload remove all")
    print(f"[*] MCDONALDS BUILT at {CX},{CZ} (floor y={G}); ~{placed} blocks; verify {good} OK / {bad} fail")
    return 0 if bad==0 else 1

if __name__=="__main__":
    sys.exit(main())
