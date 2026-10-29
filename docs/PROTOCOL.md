# LB-M8 settings protocol

This is the protocol the Lingbao M8 uses for its settings, as worked out from the official Windows driver (`LB-M8_V1.0.3`) and checked against a real mouse. No vendor code or files are part of this project. Everything here was confirmed by reading the value back from the mouse, unless the table says otherwise.

## The device

| Connection | USB ID | Notes |
|---|---|---|
| USB cable | `b6a4:4000` | Reports itself as "YXT LB-M8". The firmware is signed by Shenzhen Yixintong Electronic Science & Technology ("YXT"). |
| 2.4 GHz receiver | `b6a4:4001` | Same protocol, forwarded to the mouse over the air. |
| Bluetooth | not yet known | The Windows app uses a separate BLE library. |

The mouse has three HID interfaces. Settings live on **interface 2**, in a vendor collection with usage page `0xFF01`. That collection has one **feature report, ID 6, 40 bytes long**. All commands go through it.

On Linux the browser needs read and write access to that `hidraw` node. The rule in [`linux/70-lingbao-lbm8.rules`](../linux/70-lingbao-lbm8.rules) grants it to the logged-in user. It must sort before `73-seat-late.rules`, or the `uaccess` tag arrives too late.

## Packet layout

Every request is a feature report 6 with this payload (the report ID comes first on the wire, then these 40 bytes):

| Byte | Meaning |
|---|---|
| 0–1 | `00 00` |
| 2 | Command |
| 3 | Sequence number. Any value; the app increments it per request. |
| 4 | Argument (sub-setting) |
| 5–6 | Address, little-endian (0 for everything below) |
| 7 | Data length |
| 8… | Data |

No checksum is used.

**Reads** set bit 7 of the command (`0x86` reads what `0x06` writes). Send the request, then fetch feature report 6. The reply has the same layout, with the same command and sequence number, and the value in bytes 8 onward.

Over 2.4 GHz an idle mouse can answer late, so the first fetch may still return the previous reply. Keep fetching until bytes 2 and 3 match your request, and resend if needed. The official app retries up to 5 times.

**Writes** get no reply. Send them, then wait about 50 ms. Read the value back to confirm the mouse kept it.

## Commands

| Write | Read | Arg | Length | Value | Status |
|---|---|---|---|---|---|
| `06` | `86` | 0 | 20 | DPI levels, see below | Verified |
| `03` | `83` | 0 | 1 | Polling rate as 1000 ÷ Hz: `8` = 125, `4` = 250, `2` = 500, `1` = 1000. Measured on the real mouse. | Verified |
| `02` | `82` | 3 | 2 | Sleep timer in seconds, u16 little-endian. The app offers 1–30 minutes. | Verified |
| `02` | `82` | 5 | 1 | Sensor flags. Bit 0 = angle snapping, bit 1 = ripple control. Bit 7 is set on the test mouse and its meaning is unknown, so keep the other bits as read. | Verified |
| `0A` | `8A` | 2 | 1 | Button debounce in milliseconds. The app offers 1–20. | Verified |
| `0A` | `8A` | 6 | 1 | Move to wake up, 0 or 1 | Read verified, write untested |
| — | `81` | 0 | 3 | Status: byte 0 = link (0 cable, 1 receiver), byte 1 = battery percent in bits 0–6 plus charging in bit 7 | Verified |
| — | `F0` | 1 | 8 | Firmware version as ASCII, for example `2.3.0000` | Verified |
| `02` | `82` | 4 | 2 | A second timer in seconds, likely the deep-sleep ("PD") time. Not shown by the app for this model. | Read only |
| `02` | `82` | 6 | 1 | LOD height. For the PAW3311 sensor the official app always writes 0. | Read only |

Seen in the driver but not decoded: `04` and `05` (button mapping), `07` (24 bytes, probably DPI indicator colours), `08` (macros, 32-byte blocks), `09` (lighting, 25 bytes), `0A` args 1, 10, 11 and 12, and `70`/`71`.

## DPI block (`06` / `86`, 20 bytes)

| Byte | Meaning |
|---|---|
| 0 | Bitmask of levels in the DPI button cycle (bit 0 = level 1) |
| 1 | Level in use, **counting from 1** |
| 2–17 | 8 sensor codes, u16 little-endian, one per level |
| 18–19 | Packed 2-bit values per level, meaning unknown. Write them back unchanged. |

The level in use must be in the cycle.

The sensor is a PixArt PAW3311: 100–12000 DPI in steps of 100. DPI values map to codes through a table in the driver, for example:

| DPI | 100 | 800 | 1000 | 1200 | 1600 | 2000 | 3200 | 4800 | 7200 | 12000 |
|---|---|---|---|---|---|---|---|---|---|---|
| Code | 0 | 9 | 11 | 13 | 18 | 23 | 38 | 57 | 86 | 143 |

The full table is in [`lbm8.js`](../lbm8.js).

Factory levels: 1200, 2000, 3200, 4800, 7200, 12000 (levels 1–6 on), plus spare levels 4000 and 12000 (off).

Example reply from a real mouse with levels 1000, 1600, 2000, 2600, 3600, 4800, 6000 and 12000, all on, level 2 in use:

```
ff 02 0b 00 12 00 17 00 1e 00 2a 00 39 00 47 00 8f 00 00 00
```

## How it was worked out

1. Unpacked the Inno Setup 6.3 installer with `innoextract` (the development build; 1.9 can't read 6.3).
2. Found `HidD_SetFeature` and `HidD_GetFeature` in the driver's imports. Disassembled the code around them with Capstone, which showed the 41-byte report 6 packet builder.
3. Mapped the app's internal settings fields to commands by following its two command dispatch tables, and mapped fields to setting names through `Set.ini`.
4. Took the DPI-to-code table from the driver's sensor configuration (`[chip8] //3311`).
5. Checked every command on the real mouse:
   - reads first;
   - then writes of the value it already had;
   - then real changes, each read back afterwards;
   - and finally a browser end-to-end test that changes everything and restores the original bytes.
