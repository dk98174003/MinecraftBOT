#!/usr/bin/env python3
"""Clean castle on a FLAT plain.
1) Clear all terrain/trees/structures in the site.
2) Build a flat plain (dirt base + grass surface) at y=100.
3) Rebuild the whole castle (keep + outer wall + towers + gate + bridge)
   on that one flat level so it's clearly visible.
"""
PL=100                       # plain surface = castle base level
X0S,X1S,Z0S,Z1S=35,85,15,60  # site (clear + plain)
XK0,XK1=49,71                # keep footprint
ZK0,ZK1=29,51
XW0,XW1=40,80                # outer wall span
ZW=20                        # outer wall south face
BRICK="minecraft:stone_bricks"; COBBL="minecraft:cobblestone"
STONE="minecraft:stone"; GLASS="minecraft:glass"; BARS="minecraft:iron_bars"
AIR="minecraft:air"; DIRT="minecraft:dirt"; GRASS="minecraft:grass_block"
def gen():
    c=[]
    def fill(x0,y0,z0,x1,y1,z1,b): c.append(f"fill {x0} {y0} {z0} {x1} {y1} {z1} {b}")
    # --- 1) CLEAR the site (terrain, trees, old structures) ---
    fill(X0S,96,Z0S,X1S,130,Z1S,AIR)
    # --- 2) FLAT PLAIN ---
    fill(X0S,96,Z0S,X1S,99,Z1S,DIRT)        # dirt base
    fill(X0S,PL,Z0S,X1S,PL,Z1S,GRASS)       # grass surface
    # --- 3) KEEP (23x23) ---
    fill(XK0,PL,ZK0,XK1,PL,ZK1,BRICK)       # base slab
    fill(XK0,PL+1,ZK0,XK1,PL+6,ZK0,COBBL)   # south wall
    fill(XK0,PL+1,ZK1,XK1,PL+6,ZK1,COBBL)   # north wall
    fill(XK0,PL+1,ZK0,XK0,PL+6,ZK1,COBBL)   # west wall
    fill(XK1,PL+1,ZK0,XK1,PL+6,ZK1,COBBL)   # east wall
    # keep gate (south, center x=60, width 3)
    fill(59,PL+1,ZK0,61,PL+3,ZK0,AIR)
    fill(59,PL+4,ZK0,61,PL+5,ZK0,GLASS)
    # windows (iron bars, y=PL+4)
    for x in (52,56,64,68):
        c.append(f"setblock {x} {PL+4} {ZK0} {BARS}")
        c.append(f"setblock {x} {PL+4} {ZK1} {BARS}")
    for z in (36,44):
        c.append(f"setblock {XK0} {PL+4} {z} {BARS}")
        c.append(f"setblock {XK1} {PL+4} {z} {BARS}")
    # corner towers (3x3, y=PL..PL+12) + 5x5 caps (y=PL+13)
    for (tx,tz) in [(XK0,ZK0),(XK1,ZK0),(XK0,ZK1),(XK1,ZK1)]:
        fill(tx-1,PL,tz-1,tx+1,PL+12,tz+1,BRICK)
        fill(tx-2,PL+13,tz-2,tx+2,PL+13,tz+2,BRICK)
    # roof (y=PL+7)
    fill(XK0+3,PL+7,ZK0+3,XK1-3,PL+7,ZK1-3,STONE)
    # --- 4) OUTER WALL (2 thick) ---
    fill(XW0,PL,ZW,XW1,PL+5,ZW+1,BRICK)          # south
    fill(XW0,PL,ZW+2,XW0+1,PL+5,ZW+6,BRICK)      # west return
    fill(XW1-1,PL,ZW+2,XW1,PL+5,ZW+6,BRICK)      # east return
    # outer corner towers (3x3, y=PL..PL+12) + 5x5 caps
    for (tx) in (XW0-1,XW1):
        fill(tx,PL,ZW-1,tx+2,PL+12,ZW+1,BRICK)
        fill(tx-1,PL+13,ZW-2,tx+3,PL+13,ZW+2,BRICK)
    # outer gate (south, center x=60, width 3)
    fill(59,PL,ZW,61,PL+2,ZW+1,AIR)
    fill(59,PL+3,ZW,61,PL+4,ZW+1,GLASS)
    # --- 5) BRIDGE (flat, y=PL, z=ZW+2..ZK0-1) ---
    fill(59,PL,ZW+2,61,PL,ZK0-1,STONE)
    fill(58,PL+1,ZW+2,58,PL+1,ZK0-1,COBBL)       # west rail
    fill(62,PL+1,ZW+2,62,PL+1,ZK0-1,COBBL)       # east rail
    return c
if __name__=="__main__":
    c=gen()
    open("/data/minecraft-bot/cmds_flat.txt","w").write("\n".join(c)+"\n")
    print(f"flat-plain castle: {len(c)} cmds")
