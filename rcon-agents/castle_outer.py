#!/usr/bin/env python3
"""Outer structures around the castle: outer wall (mur), corner towers (taarn),
outer gate, and a descending causeway/bridge (bro) into the keep.
Builds on the flat plain at y=100 (south side), ramping down to the keep at y=94.
"""
PL=100            # plain / build base level
BRICK="minecraft:stone_bricks"
COBBL="minecraft:cobblestone"
GLASS="minecraft:glass"
STONE="minecraft:stone"
AIR="minecraft:air"
X0,X1=40,80       # outer wall span
ZS=20            # outer wall south face
ZRET=26          # where plain ends / castle begins
def gen():
    c=[]; v=[]
    def fill(x0,y0,z0,x1,y1,z1,b): c.append(f"fill {x0} {y0} {z0} {x1} {y1} {z1} {b}")
    def ck(x,y,z,b): v.append(f"execute if block {x} {y} {z} {b}")
    # --- outer curtain wall (2 thick), y=100-105 ---
    fill(X0,PL,ZS,X1,PL+5,ZS+1,BRICK)              # south wall
    fill(X0,PL,ZS+2,X0+1,PL+5,ZRET,BRICK)         # west return
    fill(X1-1,PL,ZS+2,X1,PL+5,ZRET,BRICK)         # east return
    ck(40,PL,ZS,BRICK); ck(80,PL,ZS,BRICK)        # wall ends
    ck(40,PL,24,BRICK); ck(80,PL,24,BRICK)        # returns
    ck(60,PL+5,ZS,BRICK)                          # wall top
    # --- corner towers (3x3, tall) + 3x3 caps ---
    for (tx) in (39,79):
        fill(tx,PL,19,tx+2,PL+12,21,BRICK)
        fill(tx,PL+13,19,tx+2,PL+13,21,BRICK)     # cap
        ck(tx+1,PL,20,BRICK); ck(tx+1,PL+13,20,BRICK)  # tower body + cap
    # --- outer gate (south wall, center x=60, width 3) ---
    fill(59,PL,20,61,PL+2,21,AIR)                 # opening
    fill(59,PL+3,20,61,PL+4,21,GLASS)            # glass lintel
    ck(60,PL+1,20,AIR); ck(60,PL+3,20,GLASS)
    # --- descending causeway/bridge: outer gate (y=100) -> keep (y=94) ---
    # floor staircase x=59-61, z=22..28; rails at x=58 & x=62
    levels={22:100,23:99,24:98,25:97,26:96,27:95,28:94}
    for z,l in levels.items():
        fill(59,l,z,61,l,z,STONE)
        fill(58,l+1,z,58,l+1,z,COBBL)
        fill(62,l+1,z,62,l+1,z,COBBL)
    ck(60,100,22,STONE); ck(60,98,24,STONE); ck(60,94,28,STONE)  # ramp floors
    ck(58,101,22,COBBL); ck(62,95,27,COBBL)                        # rails
    return c,v
if __name__=="__main__":
    c,v=gen()
    open("/data/minecraft-bot/cmds2.txt","w").write("\n".join(c)+"\n")
    open("/data/minecraft-bot/verify2.txt","w").write("\n".join(v)+"\n")
    print(f"outer structures: {len(c)} build cmds, {len(v)} verify checks")
