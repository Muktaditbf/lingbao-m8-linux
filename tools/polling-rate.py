# Measures the mouse's real report (polling) rate, three times, without changing any settings.
# Usage: python3 tools/polling-rate.py   then move the mouse quickly in circles until it prints 3 lines.
# Needs read access to the mouse (see linux/70-lingbao-lbm8.rules).
import os, select, statistics, time
MOUSE = '/dev/input/by-id/usb-YXT_LB-M8-hidraw'
fd = os.open(MOUSE, os.O_RDONLY | os.O_NONBLOCK)
for n in range(3):
    ts, start, deadline = [], None, time.time() + 90
    while time.time() < deadline:
        if not select.select([fd], [], [], 0.5)[0]: continue
        while True:
            try: os.read(fd, 64)
            except BlockingIOError: break
            ts.append(time.monotonic())
        start = start or time.monotonic()
        if time.monotonic() - start > 3: break
    gaps = [b - a for a, b in zip(ts, ts[1:]) if b - a < 0.02]
    fast = sum(g < 0.0015 for g in gaps)
    print(f'run {n+1}: {1/statistics.median(gaps):.0f} Hz median from {len(gaps)} reports ({fast} at ~1 ms spacing)' if len(gaps) > 50 else f'run {n+1}: not enough movement ({len(gaps)} reports)', flush=True)
    time.sleep(0.5)
