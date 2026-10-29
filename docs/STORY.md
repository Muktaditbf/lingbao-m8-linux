# The mouse that only spoke Windows

*How I got my gaming mouse's settings working on Linux in one night, by reading its Windows driver.*

I used Windows for years. When I moved to Linux (CachyOS with KDE Plasma), almost everything came with me: browser, editor, games. One thing didn't: my mouse software.

My mouse is a **Lingbao M8**, a tri-mode gaming mouse with a PixArt PAW3311 sensor and a little display that shows the DPI. On Windows, Lingbao's app let me set the DPI levels, polling rate, sleep timer and more. On Linux there was nothing. The mouse worked, but I couldn't change any of it.

This is how that changed between the evening of 29 October and the early morning of 30 October 2026. I worked with Claude Code, an AI coding assistant, as my pair. I asked the questions, tested on the real mouse and made the calls; it dug through the driver and wrote the code.

## What is this thing, really?

The first surprise came from `lsusb`. My "Lingbao M8" introduced itself as `YXT LB-M8`, USB ID `b6a4:4000`. YXT turned out to be the chip and firmware maker, Shenzhen Yixintong. Lingbao is the brand on the box.

That explained why searching for my mouse led nowhere. Linux's firmware tool `fwupd` didn't know it. Piper and libratbag, the usual Linux tools for gaming mice, only support known brands. I was on my own.

## Dead ends first

Lingbao's website has browser-based drivers. Chrome-based browsers can talk to USB devices directly through an API called WebHID, so a web driver would have worked on Linux as is.

I found four of them hidden in the site's code. I tried every one, and every one said "No compatible devices found". They were for Lingbao's keyboards and other mice, not the M8.

What I did have was the Windows driver: a zip file with an installer, `LB-M8_V1.0.3.exe`.

## Opening the driver

On Windows I would have just double-clicked it. On Linux it became the key to everything.

The installer was built with Inno Setup 6.3, which is too new for the packaged `innoextract`. Installing the development build from the AUR (`paru -S innoextract-git`) unpacked it. Inside was the real app, `LB-M8.exe`, plus a folder of config files.

Two things in there mattered:

- **The imports.** The app calls `HidD_SetFeature` and `HidD_GetFeature`. Earlier I had peeked at the mouse's own description of itself and found a hidden 40-byte "feature report" with ID 6. Those two Windows calls are how you use exactly that kind of report. So the settings channel was report 6.
- **`DeviceFeature.ini`.** A table for each sensor the app supports, including one labelled `3311`. It maps every DPI value from 100 to 12000 to a number the sensor understands, for example 1200 DPI → 13.

## Learning the mouse's language

Disassembling the area around those HID calls (turning the machine code back into readable instructions) showed how the app builds every packet:

```
00 00 <command> <sequence> <argument> <address> <length> <data…>
```

It also showed one rule: reads are the same command with the top bit set.

We tested in small, safe steps:

1. **Reads only.** Asking for command `86` returned codes that decoded to exactly the factory levels printed on the store listing: 1200, 2000, 3200, 4800, 7200, 12000. That was the moment I knew we had it.
2. **"Changing" a setting to the value it already had.** This was the first write, and it couldn't hurt anything. The mouse accepted it.
3. **Real changes, each read back afterwards.**

After that, we found DPI, polling rate, sleep timer, button debounce, angle snapping and ripple control by following the app's internal tables. Each one was confirmed on the mouse before I trusted it.

## The bug the mouse caught

I asked for my new DPI levels and for 1600 DPI to be active. The tool said done. Then I looked at the mouse and its little display said **1000**.

The display was right. The mouse counts its levels from 1, and we had been counting from 0. One press of the DPI button and a re-read proved it. Later the official app's own code confirmed it: it adds 1 before sending.

That's the best argument I know for testing on real hardware: the mouse corrected the software.

## Proving it, not assuming it

Some things you can't check by reading a stored value. To check polling rate, we timed the mouse's own movement reports while I moved it in circles. At 1000 Hz they arrived every millisecond, and at 250 Hz every four.

Later I noticed that the cable felt "faster" than 2.4 GHz. Measuring settled it: both ran at a solid 1000 Hz. The real cause was KDE, which had mouse acceleration switched on for the cable connection only. One setting later, both felt the same.

## Going wireless

The 2.4 GHz receiver shows up as a different device, `b6a4:4001`. It needed its own permission rule, but it speaks the same protocol. It also taught us something the cable never did: an idle wireless mouse sometimes answers late. The app now waits for the reply that matches its question and retries if it has to, the way the official Windows app does.

## From script to app

What started as Python one-liners became a proper app:

- a single web page that talks to the mouse through WebHID, with no driver and nothing to compile;
- a big DPI readout and LED-style meters for the 8 DPI levels, which follow the mouse when you press its DPI button;
- every change checked before it's sent and read back after;
- a hardware test that changes every setting on the real mouse, checks what it stored, and puts everything back byte for byte;
- an app-menu launcher, so it opens like any other program.

## What I took away from it

Coming from Windows, I was used to hardware simply coming with an app. On Linux, when nobody has written that app yet, you can write it, and the answers are often already on your disk. Here they were inside a Windows installer, a config file and a USB descriptor.

It also changed how I think about "reverse engineering". It wasn't hacking. It was careful reading, small safe experiments, and letting the hardware have the final word.

If you have a Lingbao M8, or another mouse built on YXT's chips, I hope this saves you the night. The full protocol is in [PROTOCOL.md](PROTOCOL.md).
