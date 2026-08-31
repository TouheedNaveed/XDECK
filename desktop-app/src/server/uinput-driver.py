#!/usr/bin/env python3
"""
XDECK Native Linux uinput Driver
Provides zero-latency, 100% native mouse movement, clicks, and scrolling on Wayland & X11.
"""
import sys
import os
import struct
import fcntl
import time
import signal

UI_SET_EVBIT   = 0x40045564
UI_SET_KEYBIT  = 0x40045565
UI_SET_RELBIT  = 0x40045566
UI_DEV_SETUP   = 0x405c5503
UI_DEV_CREATE  = 0x5501
UI_DEV_DESTROY = 0x5502

EV_SYN = 0x00
EV_KEY = 0x01
EV_REL = 0x02

REL_X = 0x00
REL_Y = 0x01
REL_WHEEL = 0x08
REL_HWHEEL = 0x06

BTN_LEFT = 0x110
BTN_RIGHT = 0x111
BTN_MIDDLE = 0x112

BUTTON_MAP = {
    1: BTN_LEFT,
    2: BTN_MIDDLE,
    3: BTN_RIGHT,
}

def main():
    try:
        fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)
    except Exception as e:
        sys.stderr.write(f"[XDECK-UINPUT] Failed to open /dev/uinput: {e}\n")
        sys.stderr.flush()
        sys.exit(1)

    try:
        fcntl.ioctl(fd, UI_SET_EVBIT, EV_KEY)
        fcntl.ioctl(fd, UI_SET_KEYBIT, BTN_LEFT)
        fcntl.ioctl(fd, UI_SET_KEYBIT, BTN_RIGHT)
        fcntl.ioctl(fd, UI_SET_KEYBIT, BTN_MIDDLE)

        fcntl.ioctl(fd, UI_SET_EVBIT, EV_REL)
        fcntl.ioctl(fd, UI_SET_RELBIT, REL_X)
        fcntl.ioctl(fd, UI_SET_RELBIT, REL_Y)
        fcntl.ioctl(fd, UI_SET_RELBIT, REL_WHEEL)
        fcntl.ioctl(fd, UI_SET_RELBIT, REL_HWHEEL)

        setup = struct.pack('HHHH80sI', 0x03, 0x1234, 0x5678, 1, b'XDECK Virtual Mouse\x00', 0)
        fcntl.ioctl(fd, UI_DEV_SETUP, setup)
        fcntl.ioctl(fd, UI_DEV_CREATE)
        time.sleep(0.05)
    except Exception as e:
        sys.stderr.write(f"[XDECK-UINPUT] Failed to setup virtual device: {e}\n")
        sys.stderr.flush()
        os.close(fd)
        sys.exit(1)

    def write_event(ev_type, code, value):
        now = time.time()
        tv_sec = int(now)
        tv_usec = int((now - tv_sec) * 1000000)
        ev = struct.pack('qqHHi', tv_sec, tv_usec, ev_type, code, int(value))
        syn = struct.pack('qqHHi', tv_sec, tv_usec, EV_SYN, 0, 0)
        try:
            os.write(fd, ev + syn)
        except Exception:
            pass

    def cleanup(*args):
        try:
            fcntl.ioctl(fd, UI_DEV_DESTROY)
            os.close(fd)
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    sys.stdout.write("READY\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        cmd = parts[0]

        if cmd == 'M' and len(parts) >= 3:
            # Move relative: M <dx> <dy>
            try:
                dx = int(parts[1])
                dy = int(parts[2])
                now = time.time()
                tv_sec = int(now)
                tv_usec = int((now - tv_sec) * 1000000)
                ev_x = struct.pack('qqHHi', tv_sec, tv_usec, EV_REL, REL_X, dx)
                ev_y = struct.pack('qqHHi', tv_sec, tv_usec, EV_REL, REL_Y, dy)
                ev_syn = struct.pack('qqHHi', tv_sec, tv_usec, EV_SYN, 0, 0)
                os.write(fd, ev_x + ev_y + ev_syn)
            except Exception:
                pass

        elif cmd == 'C' and len(parts) >= 2:
            # Click / button: C <button> [mode]
            # mode: 1 = down, 0 = up, 2 or omitted = full click (down + 25ms delay + up)
            try:
                btn_num = int(parts[1])
                btn_code = BUTTON_MAP.get(btn_num, BTN_LEFT)
                mode = int(parts[2]) if len(parts) >= 3 else 2
                if mode == 1:
                    write_event(EV_KEY, btn_code, 1)
                elif mode == 0:
                    write_event(EV_KEY, btn_code, 0)
                else:
                    write_event(EV_KEY, btn_code, 1)
                    time.sleep(0.025)
                    write_event(EV_KEY, btn_code, 0)
            except Exception:
                pass

        elif cmd == 'S' and len(parts) >= 2:
            # Scroll: S <scrollY> [scrollX]
            try:
                sy = int(parts[1])
                write_event(EV_REL, REL_WHEEL, sy)
                if len(parts) >= 3:
                    sx = int(parts[2])
                    write_event(EV_REL, REL_HWHEEL, sx)
            except Exception:
                pass

        elif cmd == 'Q':
            break

    cleanup()

if __name__ == '__main__':
    main()
