#!/usr/bin/env python3
"""
Minecraft Castle-Builder Agent
Builds a castle on a vanilla server via RCON (server-side, version-agnostic).

Strategy:
  1. Connect to RCON (local 127.0.0.1 on the Pi).
  2. Detect ground level at the build site (scan for surface blocks).
  3. Force-load the build region so chunks exist.
  4. Place the castle (base, walls, gate, windows, corner towers, roof caps).
  5. Verify a sample of placed blocks by reading them back.
  6. Release the force-load and report.

Only uses commands proven to work over this server's RCON:
  setblock, execute if block, forceload add/remove.
"""
import socket, struct, sys, time, random

HOST = "172.18.0.2"
PORT = 25575
USER = ""
PASS = "8d9afbc30c493401347b3d15"

# Build site center (overworld)
CX, CZ = 60, 40
FOOT = 23          # footprint size (odd)
WALL_H = 7         # wall height (blocks, above floor)
TOWER_H = 11       # corner tower height
HALF = FOOT // 2   # 11

# block palette (all vanilla, exist in 26.2)
COBBL = "minecraft:cobblestone"
STONE = "minecraft:stone"
BRICK = "minecraft:stone_bricks"
PLANK = "minecraft:oak_planks"
GLASS = "minecraft:glass"
BARS  = "minecraft:iron_bars"

SURFACE_BLOCKS = ["grass_block","dirt","podzol","coarse_dirt","mycelium","mud","sand","coarse_gravel","gravel","stone","cobblestone","sandstone","terracotta"]

class Rcon:
    def __init__(self, host, port, user, pwd):
        self.s = socket.create_connection((host, port), timeout=20)
        self.req = 0
        self.s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4*1024*1024)
        # auth handshake (type 2)
        self.send(2, f"{user}\0{pwd}")
        rtype, rid, body = self.recv()
        if rtype == 0 and b"Failed" in body.encode('utf-8','ignore'):
            # some servers reject explicit auth; continue anyway
            pass
    def _pkt(self, rtype, body):
        b = body.encode('utf-8')
        self.req += 1
        return struct.pack("<iii", len(b)+8, self.req, rtype) + b + b"\x00\x00"
    def send(self, rtype, body):
        self.s.sendall(self._pkt(rtype, body))
    def recv(self):
        raw = self._recvn(12)
        if not raw or len(raw) < 12:
            return (255, 0, "")
        length, rid, rtype = struct.unpack("<iii", raw)
        body = self._recvn(max(length-8, 0))
        return (rtype, rid, body.rstrip(b"\x00").decode('utf-8','ignore'))
    def _recvn(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.s.recv(n-len(buf))
            if not chunk: break
            buf += chunk
        return buf
    def cmd(self, c):
        self.send(3, c)
        rtype, rid, body = self.recv()
        return body
    def ok(self, c):
        return self.cmd(c).strip() in ("", "Test passed")
    def close(self):
        try: self.s.close()
        except: pass

def detect_ground(r, cx, cz):
    """Return highest y where a surface block sits at/around (cx,cz)."""
    best = None
    for dx in (-2,0,2):
      for dz in (-2,0,2):
        x,z = cx+dx, cz+dz
        for y in range(100, 25, -1):
            for blk in SURFACE_BLOCKS:
                if r.ok(f"execute if block {x} {y} {z} minecraft:{blk}"):
                    if best is None or y > best: best = y
                    break
            else:
                continue
            break
    return best

def build(r):
    # Force-load build region FIRST (with headroom for towers) so chunks load
    r.cmd(f"forceload add {CX-HALF-8} {CZ-HALF-8} {CX+HALF+8} {CZ+HALF+8}")
    time.sleep(1.5)

    G = detect_ground(r, CX, CZ)
    if G is None:
        # fallback: assume a flat plain around y=70
        G = 70
    floor = G          # top of ground = floor level we build on
    f = floor + 1      # first buildable (air) block above ground
    print(f"[*] ground/floor level = {floor}, building from y={f} (site {CX},{CZ})")

    placed = 0
    def sb(x,y,z,b):
        nonlocal placed
        r.cmd(f"setblock {x} {y} {z} {b}")
        placed += 1

    # ---- Base platform: a stone ring under the walls ----
    for x in range(CX-HALF, CX+HALF+1):
        for z in range(CZ-HALF, CZ+HALF+1):
            edge = (x in (CX-HALF,CX+HALF)) or (z in (CZ-HALF,CZ+HALF))
            if edge:
                sb(x, floor, z, BRICK)

    # ---- Walls (height WALL_H above floor) with gate + windows ----
    gate_cx = CX            # gate on south face (z = CZ-HALF)
    gate_half = 2          # gate width = 4 (gate_cx-1..+1), gate_cx±1
    for h in range(f, f+WALL_H):
        for x in range(CX-HALF, CX+HALF+1):
            for z in (CZ-HALF, CZ+HALF):   # north + south walls
                # gate opening on south wall
                if z == CZ-HALF and (x in (gate_cx-1, gate_cx) ) and (h <= f+3):
                    if h <= f+1: sb(x,h,z,GLASS)     # glass gate top
                    continue                          # leave gate void below
                sb(x,h,z,COBBL)
        for z in range(CZ-HALF, CZ+HALF+1):
            for x in (CX-HALF, CX+HALF):   # east + west walls
                sb(x,h,z,COBBL)
        # windows: iron bars 1x1 at mid-height, on each wall (skip corners & gate)
        if h == f + 4:
            for x in range(CX-HALF+2, CX+HALF-1, 4):
                r.cmd(f"setblock {x} {h} {CZ-HALF} {BARS}"); placed+=1
                r.cmd(f"setblock {x} {h} {CZ+HALF} {BARS}"); placed+=1
            for z in range(CZ-HALF+2, CZ+HALF-1, 4):
                r.cmd(f"setblock {CX-HALF} {h} {z} {BARS}"); placed+=1
                r.cmd(f"setblock {CX+HALF} {h} {z} {BARS}"); placed+=1

    top = f + WALL_H - 1    # top of walls
    # ---- Wall caps (brick top row) ----
    for x in range(CX-HALF, CX+HALF+1):
        sb(x, top+1, CZ-HALF, BRICK); sb(x, top+1, CZ+HALF, BRICK)
    for z in range(CZ-HALF, CZ+HALF+1):
        sb(CX-HALF, top+1, z, BRICK); sb(CX+HALF, top+1, z, BRICK)

    # ---- Corner towers (taller, stone brick) ----
    corners = [(CX-HALF,CZ-HALF),(CX+HALF,CZ-HALF),(CX-HALF,CZ+HALF),(CX+HALF,CZ+HALF)]
    for (tx,tz) in corners:
        for h in range(floor, floor+TOWER_H+1):
            sb(tx,h,tz,BRICK)
        # tower cap: 3x3 brick slab on top
        for dx in (-1,0,1):
            for dz in (-1,0,1):
                sb(tx+dx, floor+TOWER_H+1, tz+dz, BRICK)

    # ---- Roof: a flat stone roof over the inner keep (inset) ----
    roofy = top+1
    for x in range(CX-HALF+2, CX+HALF-1):
        for z in range(CZ-HALF+2, CZ+HALF-1):
            sb(x, roofy, z, STONE)

    return G, placed, (CX,CZ,floor)

def verify(r, G):
    floor = G+1
    top = floor + WALL_H - 1
    cx, cz = CX, CZ
    # sample checkpoints that MUST be correct
    checks = [
        (CX, floor, CZ-HALF, COBBL),       # south wall
        (CX, floor, CZ+HALF, COBBL),       # north wall
        (CX-HALF, floor, CZ, COBBL),       # west wall
        (CX+HALF, floor, CZ, COBBL),       # east wall
        (CX, top+1, CZ-HALF, BRICK),       # cap
        (CX-HALF, floor+TOWER_H, CZ-HALF, BRICK),  # tower
        (CX-HALF, floor+TOWER_H+1, CZ-HALF, BRICK),# tower cap
        (CX, top+1, CZ, STONE),             # roof center
    ]
    good=0; bad=0
    for (x,y,z,b) in checks:
        if r.ok(f"execute if block {x} {y} {z} {b}"): good+=1
        else: bad+=1; print(f"  [VERIFY FAIL] {x} {y} {z} expected {b}")
    return good, bad

def main():
    r = Rcon(HOST, PORT, USER, PASS)
    try:
        print("[*] connected to RCON")
        G, placed, site = build(r)
        time.sleep(0.5)
        good, bad = verify(r, G)
        # release force-load
        r.cmd("forceload remove all")
        print(f"[*] CASTLE BUILT at {site[0]},{site[1]} (floor y={site[3]})")
        print(f"[*] placed ~{placed} blocks")
        print(f"[*] verification: {good} OK / {bad} fail (of {good+bad} checkpoints)")
        print(f"[*] forceload released")
        return 0 if bad==0 else 1
    finally:
        r.close()

if __name__ == "__main__":
    sys.exit(main())
