# Line protocol on stdin/stdout: "S <80 hex>" -> sends feature report 6, replies "ok";
# "R" -> replies with 40-byte feature report 6 as hex. Reopens the device if it re-enumerates.
import fcntl, os, sys, time
PATH = '/dev/input/by-id/usb-YXT_LB-M8-if02-hidraw'
def IOC(nr, n): return (3 << 30) | (n << 16) | (ord('H') << 8) | nr
fd = None
def dev():
    global fd
    if fd is None:
        for _ in range(50):
            try: fd = os.open(PATH, os.O_RDWR); break
            except OSError: time.sleep(0.1)
    return fd
for line in sys.stdin:
    line = line.strip()
    try:
        if line.startswith('S '):
            b = bytearray([6]) + bytes.fromhex(line[2:])
            fcntl.ioctl(dev(), IOC(6, 41), b); print('ok', flush=True)
        elif line == 'R':
            r = bytearray(41); r[0] = 6; fcntl.ioctl(dev(), IOC(7, 41), r, True)
            print(r[1:].hex(), flush=True)
    except OSError as e:
        fd = None; print('err ' + str(e), flush=True)
